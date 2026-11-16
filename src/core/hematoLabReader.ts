// src/core/hematoLabReader.ts
//
// Reconstruye el cuadro hematológico a partir de las ANALÍTICAS RESULTADAS.
//
// MOTIVO: el panel de hematología necesita cruzar plaquetas, fibrinógeno, INR y
// dímero-D, que viven en tres pruebas distintas con tiempos de respuesta
// distintos. Leerlas del estado vivo del paciente habría sido trivial y habría
// vaciado de sentido el modelo de laboratorio que el proyecto ya tiene: cada
// prueba con su demora, los urgentes saturando la cola, la muestra congelando
// los valores del instante de la extracción. Un panel que mostrara las
// plaquetas que el paciente tiene AHORA, sin que nadie las haya pedido,
// convierte ese modelo en decorado y enseña a diagnosticar con información que
// en la cama no se tiene.
//
// Así que se lee de donde se lee en la realidad: del último resultado
// disponible de cada prueba. Lo que no se ha medido no se inventa — se informa
// como ausente, y quien interpreta sabe que le falta ese dato.

import type { LabOrder } from '../store/usePatientStore';

/** Un valor medido, con el momento de la extracción que lo produjo. */
export interface Measured {
  value: number;
  /** Segundos de simulación en que se extrajo la muestra. */
  drawnAtSimS: number;
  /** Segundos de simulación en que el resultado estuvo disponible. */
  resultedAtSimS: number;
}

/** Las magnitudes hematológicas que el panel puede llegar a tener. */
export interface HematoLabs {
  plateletsK?: Measured;
  fibrinogenMgDl?: Measured;
  inr?: Measured;
  dDimerNgMl?: Measured;
  ldhUl?: Measured;
  haptoglobinMgDl?: Measured;
  schistocytes?: Measured;
  adamts13Pct?: Measured;
  uricAcidMgDl?: Measured;
  phosphateMgDl?: Measured;
  kPlasma?: Measured;
  creatinine?: Measured;
  ancK?: Measured;
}

/** Claves candidatas de cada magnitud, en orden de preferencia.
 *  Varias pruebas informan el mismo analito —el fósforo sale del panel de
 *  lisis tumoral y del Mg/P/Ca, el potasio de tres sitios— y cualquiera de
 *  ellas sirve: lo que importa es que se haya medido. */
const KEYS: Record<Exclude<keyof HematoLabs, 'ancK'>, string[]> = {
  plateletsK:      ['Plaquetas'],
  fibrinogenMgDl:  ['Fibrinogeno'],
  inr:             ['INR'],
  dDimerNgMl:      ['Dimero-D'],
  ldhUl:           ['LDH'],
  haptoglobinMgDl: ['Haptoglobina'],
  schistocytes:    ['Esquistocitos'],
  adamts13Pct:     ['Actividad ADAMTS13'],
  uricAcidMgDl:    ['Acido urico'],
  phosphateMgDl:   ['Fosforo'],
  kPlasma:         ['Potasio', 'K'],
  creatinine:      ['Creatinina'],
};

/** Las cruces del frotis se informan como texto, porque es una lectura
 *  morfológica; aquí vuelven a número para poder puntuarlas. */
const CRUCES: Record<string, number> = {
  'Ausentes': 0, '+': 1, '++': 2, '+++': 3,
};

function toNumber(raw: number | string | undefined): number | null {
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    if (raw in CRUCES) return CRUCES[raw];
    const n = parseFloat(raw);
    return isFinite(n) ? n : null;
  }
  return null;
}

/** Órdenes ya resueltas, de la más reciente a la más antigua. */
function resolvedNewestFirst(orders: LabOrder[]): LabOrder[] {
  return orders
    .filter(o => o.result !== null)
    .slice()
    .sort((a, b) => b.readyAt - a.readyAt);
}

/**
 * Extrae del historial de analíticas el último valor disponible de cada
 * magnitud hematológica. Las que nadie ha pedido quedan ausentes.
 */
export function readHematoLabs(orders: LabOrder[]): HematoLabs {
  const out: HematoLabs = {};
  const resolved = resolvedNewestFirst(orders);

  for (const order of resolved) {
    const values = order.result?.values;
    if (!values) continue;
    const stamp = { drawnAtSimS: order.orderedAt, resultedAtSimS: order.readyAt };

    for (const field of Object.keys(KEYS) as Exclude<keyof HematoLabs, 'ancK'>[]) {
      if (out[field]) continue;            // ya se tiene uno más reciente
      for (const key of KEYS[field]) {
        if (!(key in values)) continue;
        const n = toNumber(values[key]);
        if (n !== null) { out[field] = { value: n, ...stamp }; break; }
      }
    }

    // El recuento absoluto de neutrófilos no se informa: se calcula sobre el
    // leucocitario y el porcentaje de segmentados MÁS cayados, que en la
    // neutropenia febril es la cifra que decide (< 500/µL) y la que el score
    // y las guías usan.
    if (!out.ancK && 'WBC total' in values && 'Neutrof. %' in values) {
      const wbc  = toNumber(values['WBC total']);
      const neut = toNumber(values['Neutrof. %']);
      const cay  = toNumber(values['Cayados %']) ?? 0;
      if (wbc !== null && neut !== null) {
        out.ancK = { value: wbc * (neut + cay) / 100, ...stamp };
      }
    }
  }

  return out;
}

/** Valores por omisión cuando una magnitud no se ha medido: el normal.
 *  Asumir lo normal es lo honesto —no se puede puntuar lo que no se sabe— y el
 *  panel marca aparte qué celdas son medidas y cuáles supuestas. */
export const HEMATO_ASSUMED = {
  plateletsK: 230,
  fibrinogenMgDl: 320,
  inr: 1.0,
  dDimerNgMl: 250,
  ldhUl: 180,
  haptoglobinMgDl: 110,
  schistocytes: 0,
  adamts13Pct: 100,
  uricAcidMgDl: 4.8,
  phosphateMgDl: 3.5,
  kPlasma: 4.0,
  creatinine: 1.0,
  ancK: 4.5,
} as const;

/** Mezcla lo medido con lo asumido, lista para interpretHemato(). */
export function hematoSnapshotFromLabs(labs: HematoLabs): typeof HEMATO_ASSUMED {
  const out = { ...HEMATO_ASSUMED } as Record<string, number>;
  for (const [field, m] of Object.entries(labs)) {
    if (m) out[field] = m.value;
  }
  return out as typeof HEMATO_ASSUMED;
}

/** ¿Hay bastante para interpretar? Sin recuento plaquetario no hay cuadro
 *  hematológico que leer, y fingir uno sería peor que no mostrar nada. */
export function hasMinimumLabs(labs: HematoLabs): boolean {
  return labs.plateletsK !== undefined;
}
