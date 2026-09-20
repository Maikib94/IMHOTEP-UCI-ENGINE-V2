// src/core/rng.ts
//
// C1.9 commit 2 — streams de RNG nombrados e independientes.
//
// MOTIVO: Math.random() es un stream global compartido por TODOS sus
// consumidores. Cualquier consumidor que extraiga numeros a un ritmo
// dependiente de dt (ej. un scheduler que dispara 240x mas seguido por el
// bug de C1.9 commit 1) desplaza la FASE del stream para TODOS los demas
// consumidores — dos corridas con la misma semilla global pero distinta
// cadencia de consumo dejan de ser comparables a partir del primer
// consumo divergente, aunque cada una use "la misma semilla". Este fue
// el mecanismo real detras del residual de mortalidad en applySepsisSdra
// (ver diagnostico C1.9): useGlycemicStore.hgtFrequency='4h' por defecto
// + el bug de reloj de commit 1 = 30 HGTs (cada uno llama gaussNoise())
// en vez de 0 durante 1800s a x1 — las dos corridas consumian el stream
// global a ritmos distintos y divergian en el ruido de FC que reciben,
// aunque nada mas hubiera cambiado.
//
// FIX ESTRUCTURAL: cada dominio fisiologico/clinico tiene su PROPIO
// generador mulberry32, independiente de los demas. Que el glucometro
// dispare 30 veces o 0 no puede desplazar la fase del ruido de FC del
// stream 'cardioNoise' — son generadores distintos con estado distinto.

export type RngStream =
  | 'cardioNoise'   // CardiovascularEngine — ruido de FC ±1 bpm
  | 'glucometer'    // useGlycemicStore — ruido gaussiano del HGT (σ=5 mg/dL)
  | 'labAssay'      // LabEngine — ruido gaussiano de resultados + leucopenia
  | 'microbiology'  // MicrobiologyEngine — seleccion de pathogeno, cultivos
  | 'prognosis'     // PrognosisEngine — probabilidad de muerte/recuperacion
  | 'ventAsync'     // VentilatorAsynchrony — eventos no mecanisticos (auto-trigger)
  | 'misc';         // todo lo demas (InfectoEngine, IDs no criticos, etc.)

const STREAMS: readonly RngStream[] = [
  'cardioNoise', 'glucometer', 'labAssay', 'microbiology', 'prognosis', 'ventAsync', 'misc',
];

/** mulberry32 — PRNG de 32 bits, rapido, sin dependencia externa.
 *  Ref: https://gist.github.com/tommyettinger/46a874533244883189143505d203312 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combina la semilla global + el nombre del stream en una semilla propia
 *  por stream (djb2 simplificado) — dos streams nunca comparten secuencia
 *  aunque partan de la misma semilla global. */
function hashSeed(seed: number, streamName: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < streamName.length; i++) {
    h = (Math.imul(h, 33) + streamName.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function createGenerators(seed: number): Record<RngStream, () => number> {
  const g = {} as Record<RngStream, () => number>;
  for (const s of STREAMS) g[s] = mulberry32(hashSeed(seed, s));
  return g;
}

let generators: Record<RngStream, () => number> = createGenerators(Date.now());
let currentSeed = 0;

/** Extrae el siguiente numero [0,1) del stream nombrado. Cada stream tiene
 *  su propio estado — el consumo de uno nunca afecta la fase de otro. */
export function rand(stream: RngStream): number {
  return generators[stream]();
}

/** Re-siembra TODOS los streams con la misma semilla base (cada uno con su
 *  propia derivacion via hashSeed). Determinista: la misma semilla produce
 *  siempre la misma secuencia en cada stream. */
export function seedAll(seed: number): void {
  currentSeed = seed;
  generators = createGenerators(seed);
}

/** Reset generico — usado por resetAllEngines(). Re-siembra con un valor
 *  no determinista por defecto; el llamador (test o produccion) debe
 *  invocar seedAll() explicitamente despues si necesita reproducibilidad.
 *  Nunca deja los streams en un estado "sin sembrar": siempre hay un PRNG
 *  valido detras de rand(), incluso si nadie llamo seedAll(). */
export function resetRng(): void {
  seedAll(Date.now());
}

/** Semilla actualmente activa — expuesta para debug (useScenarioStore). */
export function getCurrentSeed(): number {
  return currentSeed;
}

/** Deriva una semilla numerica de una etiqueta (ej. scenario.id) + el
 *  timestamp actual — cada caso clinico arranca con una semilla DISTINTA
 *  (no determinista entre casos, como corresponde a produccion real) pero
 *  REPRODUCIBLE si se conoce la semilla (queda expuesta via
 *  getCurrentSeed() / useScenarioStore para debug — ej. reportar un bug
 *  con "semilla 1234567" alcanza para reproducir la corrida exacta). */
export function seedFromLabel(label: string): number {
  return hashSeed(Date.now(), label);
}
