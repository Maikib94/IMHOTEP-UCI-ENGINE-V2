// tests/helpers/dtBisectHarness.ts
//
// C1.7 commit 4 — harness compartido entre determinism.spec.ts (gate) y
// dtBisect.spec.ts (biseccion, commit 5). Antes cada archivo tenia su
// propia copia de resetEngines()/tickSubset()/SAMPLE_FIELDS ligeramente
// distinta — eso es exactamente el tipo de deriva que permitio que la
// biseccion original corriera con menos motores reseteados que el resto
// del proyecto. Una sola fuente de verdad.

import { usePatientStore, type Vitals } from '../../src/store/usePatientStore';
import { useTimeStore } from '../../src/store/useTimeStore';
import { PathologyEngine } from '../../src/core/PathologyEngine';
import { PharmacologyEngine } from '../../src/core/PharmacologyEngine';
import { RenalEngine } from '../../src/core/RenalEngine';
import { RespiratoryEngine } from '../../src/core/RespiratoryEngine';
import { CardiovascularEngine } from '../../src/core/CardiovascularEngine';
import { AcidBaseEngine } from '../../src/core/AcidBaseEngine';
import { CrosstalkEngine } from '../../src/core/CrosstalkEngine';
import { AcuteMortalityEngine } from '../../src/core/AcuteMortalityEngine';
import { resetAllEngines } from '../../src/core/resetAllEngines';
import { resetAllStores } from './storeReset';
import { installSeededRandom, restoreRandom } from './seededRandom';

export const SAMPLE_FIELDS = [
  'bloodVolume', 'strokeVolume', 'cardiacOutput', 'meanArterialPressure',
  'urineOutput', 'heartRate', 'svr', 'cvp', 'lactate', 'hco3', 'pH',
] as const;
export type SampleField = (typeof SAMPLE_FIELDS)[number];
export type Sample = Record<SampleField, number> & { t: number };

export function readSample(t: number): Sample {
  const state = usePatientStore.getState();
  const v: Vitals = state.vitals;
  return {
    t,
    bloodVolume: state.bloodVolume,
    strokeVolume: v.strokeVolume,
    cardiacOutput: v.cardiacOutput,
    meanArterialPressure: v.meanArterialPressure,
    urineOutput: v.urineOutput,
    heartRate: v.heartRate,
    svr: v.svr,
    cvp: v.cvp,
    lactate: v.lactate,
    hco3: v.hco3,
    pH: v.pH,
  };
}

export type EngineName =
  | 'pathology' | 'pharmacology' | 'renal' | 'respiratory'
  | 'cardiovascular' | 'acidbase' | 'crosstalk' | 'mortality';

export const FULL_CHAIN: EngineName[] = [
  'pathology', 'pharmacology', 'renal', 'respiratory',
  'cardiovascular', 'acidbase', 'crosstalk', 'mortality',
];

export function tickSubset(dt: number, engines: EngineName[]): void {
  useTimeStore.getState().advanceTick(dt);
  if (engines.includes('pathology'))      PathologyEngine.getInstance().update(dt);
  if (engines.includes('pharmacology'))   PharmacologyEngine.getInstance().update(dt);
  if (engines.includes('renal'))          RenalEngine.getInstance().update(dt);
  if (engines.includes('respiratory'))    RespiratoryEngine.getInstance().update(dt);
  if (engines.includes('cardiovascular')) CardiovascularEngine.getInstance().updateHemodynamics(dt);
  if (engines.includes('acidbase'))       AcidBaseEngine.getInstance().update(dt);
  if (engines.includes('crosstalk'))      CrosstalkEngine.getInstance().update(dt);
  if (engines.includes('mortality'))      AcuteMortalityEngine.getInstance().update(dt);
}

/** Reset completo — TODOS los singletons de motor (resetAllEngines(), no
 *  un subconjunto elegido a mano) + TODOS los stores relevantes. Este es
 *  el cambio central de C1.7 commit 4: antes de resetAllEngines(), esta
 *  funcion solo reseteaba 4 de ~16 motores y CardiovascularEngine (ruido
 *  de FC con estado de fase, noiseTimer/pendingNoise) nunca se limpiaba
 *  entre corridas — suficiente para romper el determinismo aunque la
 *  semilla del RNG fuera identica. */
export function resetEngines(): void {
  resetAllStores();
  resetAllEngines();
}

/** Corre el escenario con el subconjunto de motores dado, muestreando cada
 *  1s simulado. Semilla fija — determinismo controlado. */
export function runSampled(
  dt: number,
  durationS: number,
  engines: EngineName[],
  applyFixture: () => void,
  seed: number,
): Sample[] {
  resetEngines();
  installSeededRandom(seed);
  const samples: Sample[] = [];
  try {
    applyFixture();
    samples.push(readSample(0));
    const steps = Math.round(durationS / dt);
    let nextSampleT = 1;
    for (let i = 0; i < steps; i++) {
      tickSubset(dt, engines);
      const t = (i + 1) * dt;
      if (t >= nextSampleT) {
        samples.push(readSample(Math.round(t)));
        nextSampleT += 1;
      }
    }
  } finally {
    restoreRandom();
  }
  return samples;
}

/** Compara dos series (hasta el minimo comun de muestras) y devuelve, por
 *  campo, el primer t con divergencia relativa > 1%. */
export function firstDivergence(fine: Sample[], coarse: Sample[]): Record<SampleField, number | null> {
  const result = {} as Record<SampleField, number | null>;
  const n = Math.min(fine.length, coarse.length);
  for (const f of SAMPLE_FIELDS) {
    result[f] = null;
    for (let i = 0; i < n; i++) {
      const a = fine[i][f], b = coarse[i][f];
      const diffAbs = Math.abs(a - b);
      const diffRel = a !== 0 ? diffAbs / Math.abs(a) : (b !== 0 ? Infinity : 0);
      if (diffRel > 0.01) {
        result[f] = fine[i].t;
        break;
      }
    }
  }
  return result;
}

/** Compara dos series con IDENTIDAD EXACTA (===) campo a campo, muestra a
 *  muestra. Devuelve la lista de mismatches (vacia si son bit-idénticas). */
export function exactMismatches(a: Sample[], b: Sample[]): string[] {
  const mismatches: string[] = [];
  if (a.length !== b.length) {
    mismatches.push(`longitud de serie distinta: ${a.length} !== ${b.length} muestras`);
  }
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (const f of SAMPLE_FIELDS) {
      if (a[i][f] !== b[i][f]) {
        mismatches.push(`t=${a[i].t}s ${f}: ${a[i][f]} !== ${b[i][f]}`);
      }
    }
  }
  return mismatches;
}
