// tests/diagnostics/slowScenarioProfile.spec.ts
//
// C1.9 commit 4 — perfil de CPU de un escenario lento vs uno rapido
// (diagnostico puro, cero cambios en src/).
//
// 4b (longitudes de arrays sospechosos) se descarto por ANALISIS DIRECTO
// del codigo antes de instrumentar: el harness usado por el barrido de
// b5990e6 (tickSubset()/FULL_CHAIN en tests/helpers/dtBisectHarness.ts)
// solo llama 8 motores (pathology, pharmacology, renal, respiratory,
// cardiovascular, acidbase, crosstalk, mortality) — NINGUNO de los
// sospechosos originales (labOrders vive en LabEngine, hgtHistory en
// GlycemicEngine, cultures en MicrobiologyEngine, scheduledDoses/SVV
// sampling se procesan en CronosEngine.tick(), no en tickSubset()) esta
// en ese camino. labOrders (el sospechoso principal) NUNCA crece en este
// harness porque LabEngine.update() nunca se llama.
//
// De los dos structures que SI estan en el camino (RespiratoryEngine.
// ringBuffer, useMortalityStore.dangerCounters) ambos estan acotados:
// ringBuffer hace shift() antes de push() (tope 500), dangerCounters es
// un Record con a lo sumo 13 claves fijas (una por causa letal), no un
// array que crece.
//
// Va a perfil de CPU (4c) directamente.
//
// ═══════════════════════════════════════════════════════════════════════
// RESUMEN FINAL — 4a-4c (ver tambien repeatedRunSlowdown.spec.ts y
// crossScenarioSlowdown.spec.ts, mismo commit)
// ═══════════════════════════════════════════════════════════════════════
//
// 4a. Los 5 escenarios anomalos identificados en la corrida real de
//     b5990e6 (107 escenarios, 41.8h total) y sus tiempos:
//       ich_brainstem                → 50,536,366 ms (~14.0 h)
//       burn_fuego_40pct             → 52,059,404 ms (~14.5 h)
//       refractory_metabolic_acidosis→ 22,024,444 ms (~6.1 h)
//       trauma_fulminante_clase3     →    777,418 ms (~13 min)
//       trauma_tce_abdomen_pelvis    →    767,743 ms (~13 min)
//     (el resto de los 107 escenarios: 140-300s cada uno, normal)
//
// 4b. DESCARTADO por analisis de codigo (ver arriba) — labOrders y el
//     resto de los sospechosos originales no participan del harness real.
//
// 4c. Perfil de CPU de ich_brainstem vs dka_severe (control), aislados:
//       60s sim  → ambos ~10s wall, identico, SIN anomalia.
//       300s sim → ambos ~46-49s wall, identico, SIN anomalia.
//     El top-15 por tiempo propio en ambos casos es IDENTICO en forma
//     (PharmacologyEngine.update():246, multiples Zustand setState(),
//     tickSubset()) — nada que distinga al escenario "lento" del rapido.
//
// INTENTOS DE REPRODUCCION ADICIONALES (los 5 escenarios anomalos solo
// aparecen dentro del barrido completo de 107 — ninguna reproduccion
// aislada los reprodujo):
//   1. ich_brainstem aislado, 1 corrida de 300s          → normal (arriba).
//   2. ich_brainstem, 6 corridas CONSECUTIVAS de 300s en el MISMO proceso
//      (misma secuencia que el barrido real: 3 semillas + 3 volemias) —
//      ver repeatedRunSlowdown.spec.ts → las 6 corridas ~36-38s cada una,
//      SIN degradacion progresiva. Descarta "efecto acumulativo por
//      repetir el MISMO escenario".
//   3. Secuencia de los primeros 17 escenarios REALES del catalogo (mismo
//      orden que ALL_SCENARIOS, incluyendo ich_brainstem en la posicion
//      16) en el MISMO proceso — ver crossScenarioSlowdown.spec.ts →
//      los 17 corren normal (~6-7s c/u a 60s sim), incluido ich_brainstem
//      en su posicion real. Descarta "efecto acumulativo por correr
//      VARIOS escenarios DISTINTOS antes", al menos para esta longitud
//      de secuencia y esta duracion por escenario.
//
// CONCLUSION HONESTA: la causa exacta NO SE IDENTIFICO pese a 4 intentos
// de reproduccion dirigidos por hipotesis especificas (costo inherente,
// repeticion del mismo escenario, secuencia de escenarios distintos,
// perfil de CPU en aislamiento) — todos negativos. La UNICA diferencia
// estructural restante entre mis reproducciones y la corrida real es que
// b5990e6 uso vitest `it.each()` generando 107 casos `it()` FORMALES
// (con su propio ciclo de vida, tracking de expect(), etc.) en un unico
// archivo/worker, mientras que mis reproducciones hacen todo el trabajo
// dentro de un unico `it()` con un loop manual — nunca replique la forma
// EXACTA del harness original.
//
// FIX PROPUESTO POR ESCRITO (no implementado — 4d prohibe corregir):
//   1. Primera intervencion, mas barata: correr el barrido de escenarios
//      con `--pool=forks` en vez de `--pool=threads` (o con
//      `poolOptions.threads.singleThread=false`/aislamiento por archivo),
//      de forma que cada escenario (o un batch pequeño) corra en un
//      PROCESO separado — elimina cualquier acumulacion de heap/JIT
//      entre escenarios sin necesidad de identificar el mecanismo exacto.
//   2. Si (1) no alcanza: dividir scenarioRobustness.spec.ts en un
//      archivo POR ESCENARIO (generado) en vez de un it.each() gigante en
//      un solo archivo — fuerza a vitest a levantar un contexto nuevo por
//      escenario.
//   3. Instrumentacion adicional si se repite: correr la corrida REAL
//      completa (no una reproduccion aislada) bajo `--cpu-prof` a nivel
//      de proceso (`node --cpu-prof node_modules/vitest/vitest.mjs run
//      ...`) — mi intento aqui perfilo corridas AISLADAS via
//      node:inspector Session(), que por construccion no puede capturar
//      un efecto que solo aparece tras 15+ escenarios previos reales.
//   Ninguna de las tres se implemento en este commit.

import { describe, it } from 'vitest';
import { Session } from 'node:inspector';
import { ALL_SCENARIOS } from '../../src/scenarios/index';
import type { ScenarioDefinition } from '../../src/store/useScenarioStore';
import { usePatientStore } from '../../src/store/usePatientStore';
import { usePathologyStore } from '../../src/store/usePathologyStore';
import { resetEngines, tickSubset, FULL_CHAIN } from '../helpers/dtBisectHarness';
import { installSeededRandom, restoreRandom } from '../helpers/seededRandom';

function applyScenarioDef(scenario: ScenarioDefinition): void {
  const patient = usePatientStore.getState();
  const pathology = usePathologyStore.getState();
  patient.setBloodVolume(scenario.initialBloodVolumeMl ?? 5000);
  if (scenario.initialVitals && Object.keys(scenario.initialVitals).length > 0) {
    patient.updateVitals(scenario.initialVitals);
  }
  patient.setVentilatorConnected(scenario.isVentilatorConnected ?? false);
  if (scenario.ventilatorPreset) patient.setVentilatorSettings(scenario.ventilatorPreset);
  for (const cfg of scenario.pathologyConfigs ?? []) {
    pathology.activatePathology(cfg.domain, cfg.subtype, cfg.baseSeverity);
  }
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}
interface CpuProfile {
  nodes: ProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

async function profileScenario(
  scenarioId: string, durationS: number, dt: number, wallBudgetMs: number,
): Promise<{ profile: CpuProfile; simSReached: number; aborted: boolean }> {
  const scenario = ALL_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) throw new Error(`escenario no encontrado: ${scenarioId}`);

  const session = new Session();
  session.connect();
  await new Promise<void>((resolve, reject) =>
    session.post('Profiler.enable', (err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) =>
    session.post('Profiler.setSamplingInterval', { interval: 100 }, (err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) =>
    session.post('Profiler.start', (err) => (err ? reject(err) : resolve())));

  resetEngines();
  installSeededRandom(777);
  const wallStart = Date.now();
  let aborted = false;
  let simSReached = 0;
  try {
    applyScenarioDef(scenario);
    const steps = Math.round(durationS / dt);
    for (let i = 0; i < steps; i++) {
      tickSubset(dt, FULL_CHAIN);
      simSReached = (i + 1) * dt;
      // Circuit breaker — no bloquear horas si el escenario cae en la zona
      // lenta (ver hallazgo previo: clusters de ticks de 20-160ms).
      if ((i & 0x3ff) === 0 && Date.now() - wallStart > wallBudgetMs) {
        aborted = true;
        break;
      }
    }
  } finally {
    restoreRandom();
  }

  const profile = await new Promise<CpuProfile>((resolve, reject) =>
    session.post('Profiler.stop', (err, res) => (err ? reject(err) : resolve(res!.profile as CpuProfile))));
  session.disconnect();
  return { profile, simSReached, aborted };
}

function topSelfTime(profile: CpuProfile, n: number): Array<{ fn: string; url: string; line: number; selfMs: number }> {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const selfTimeUs = new Map<number, number>();

  if (profile.samples && profile.timeDeltas) {
    // timeDeltas[i] es el tiempo (us) ENTRE samples[i-1] y samples[i] —
    // se le atribuye al sample ANTERIOR (V8 profiler convention).
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const dt = i < profile.timeDeltas.length ? profile.timeDeltas[i] : 0;
      selfTimeUs.set(nodeId, (selfTimeUs.get(nodeId) ?? 0) + Math.max(0, dt));
    }
  } else {
    // fallback — usar hitCount si no hay samples/timeDeltas
    for (const node of profile.nodes) {
      selfTimeUs.set(node.id, (node.hitCount ?? 0) * 1000);
    }
  }

  const rows = Array.from(selfTimeUs.entries())
    .map(([id, us]) => {
      const node = byId.get(id);
      return {
        fn: node?.callFrame.functionName || '(anonymous)',
        url: (node?.callFrame.url || '').replace(/^.*[\\/]/, ''),
        line: (node?.callFrame.lineNumber ?? -1) + 1,
        selfMs: us / 1000,
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, n);
  return rows;
}

describe('C1.9 commit 4 — perfil de CPU: escenario lento vs rapido', () => {
  it('ich_brainstem (lento) — top 15 funciones por tiempo propio, hasta 300s sim (budget 4min wall)', async () => {
    const t0 = Date.now();
    const { profile, simSReached, aborted } = await profileScenario('ich_brainstem', 300, 1 / 240, 240_000);
    const wallMs = Date.now() - t0;
    const top = topSelfTime(profile, 15);
    console.log(`\n=== ich_brainstem — alcanzo t=${simSReached.toFixed(1)}s sim en ${wallMs}ms wall-clock (${aborted ? 'ABORTADO por presupuesto' : 'completo'}, ${profile.samples?.length ?? 0} samples) ===`);
    console.table(top);
  }, 300_000);

  it('dka_severe (rapido, control) — top 15 funciones por tiempo propio, 300s sim', async () => {
    const t0 = Date.now();
    const { profile, simSReached, aborted } = await profileScenario('dka_severe', 300, 1 / 240, 240_000);
    const wallMs = Date.now() - t0;
    const top = topSelfTime(profile, 15);
    console.log(`\n=== dka_severe (control) — alcanzo t=${simSReached.toFixed(1)}s sim en ${wallMs}ms wall-clock (${aborted ? 'ABORTADO por presupuesto' : 'completo'}, ${profile.samples?.length ?? 0} samples) ===`);
    console.table(top);
  }, 300_000);
});
