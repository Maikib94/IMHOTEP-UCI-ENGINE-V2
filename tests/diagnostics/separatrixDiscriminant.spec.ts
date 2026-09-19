// tests/diagnostics/separatrixDiscriminant.spec.ts
//
// C1.9 commit 3 — experimento discriminante (diagnostico puro, cero
// cambios en src/). NO ARRANCA hasta que commits 1 y 2 esten verdes (lo
// estan: 4b04f3a, 7694141).
//
// tests/diagnostics/dtInvariance.spec.ts, re-corrido tras los commits 1+2,
// SIGUE divergiendo en desenlace de mortalidad para applySepsisSdra a
// 1800s (x1 muere, x10/x60 sobreviven) — el aislamiento de streams de RNG
// (commit 2) NO resolvio el residual por si solo. Este archivo corre el
// experimento discriminante de 3 series sobre ESE UNICO fixture:
//
//   A) dt FIJO=1/240, variar SOLO la semilla (8 corridas)
//   B) dt FIJO=1/240, semilla fija, variar bloodVolume inicial
//      (-1%,-0.5%,-0.2%,+0.2%,+0.5%,+1% — 6 corridas)
//   C) semilla fija, bloodVolume fijo, variar dt (1/240, 1/24, 0.25 — 3 corridas)
//
// INTERPRETACION:
//   A o B flipean  → SEPARATRIZ real — el escenario es inestable por
//                    naturaleza (sensible a condiciones iniciales/ruido),
//                    no por un bug de los motores.
//   Solo C flipea  → queda dependencia de dt residual — hay que bisecar
//                    de nuevo por motor.
//   Ninguno flipea → resuelto (contradiría el resultado de dtInvariance
//                    recien corrido, no se espera).
//
// RESULTADO (corrida real, 3843s de computo):
//   Serie A (8 semillas, dt=1/240 fijo)         → NO flipea: 8/8 mueren.
//   Serie B (6 volemias ±0.2-1%, dt=1/240 fijo) → NO flipea: 6/6 mueren.
//   Serie C (mismo seed/volemia, dt variable)   → FLIPEA: x1 muere,
//                                                  x10 y x60 sobreviven.
//
// VEREDICTO EXPLICITO: NO ES SEPARATRIZ. applySepsisSdra es COMPLETAMENTE
// ROBUSTO a semilla de RNG (8/8) y a volemia inicial (6/6) a dt fino fijo
// — el unico eje que cambia el desenlace es dt mismo. Esto descarta la
// hipotesis de "escenario inestable por naturaleza" que motivo C1.7-fix
// commit 2 (b5990e6) y confirma que queda una DEPENDENCIA DE DT RESIDUAL
// real en algun motor — un bug numerico reproducible, no ruido. La
// hipotesis original del VentilatorSM100Engine PHYS_HZ (C1.7 commit 5,
// descartada en su momento por falta de determinismo bit-a-bit) amerita
// re-examinarse ahora que el harness SI es deterministico — pero esa
// re-biseccion queda para un PR posterior (propuesto por escrito, no
// implementado aqui — ver reporte).

import { describe, it, expect } from 'vitest';
import { usePatientStore } from '../../src/store/usePatientStore';
import { useMortalityStore } from '../../src/store/useMortalityStore';
import { applySepsisSdra } from '../fixtures/clinicalCases';
import { advanceSimSeconds } from '../helpers/timeAdvance';
import { resetEngines } from '../helpers/dtBisectHarness';
import { installSeededRandom, restoreRandom } from '../helpers/seededRandom';

const BASE_SEED = 1337;
const BASE_DT = 1 / 240;
const DURATION_S = 1800;

interface RunOutcome {
  label: string;
  isDeceased: boolean;
  finalMAP: number;
}

function runOnce(seed: number, dt: number, bvOverrideMl?: number): RunOutcome {
  resetEngines();
  installSeededRandom(seed);
  try {
    applySepsisSdra();
    if (bvOverrideMl !== undefined) {
      usePatientStore.getState().setBloodVolume(bvOverrideMl);
    }
    advanceSimSeconds(DURATION_S, dt);
  } finally {
    restoreRandom();
  }
  return {
    label: '',
    isDeceased: useMortalityStore.getState().isDeceased,
    finalMAP: usePatientStore.getState().vitals.meanArterialPressure,
  };
}

describe('C1.9 commit 3 — experimento discriminante de separatriz (applySepsisSdra, 1800s)', () => {
  it('Serie A — dt fijo=1/240, variar semilla (8 corridas)', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = seeds.map(seed => ({
      ...runOnce(seed, BASE_DT),
      label: `seed=${seed}`,
    }));
    console.log('\n=== Serie A — dt=1/240 fijo, semilla variable ===');
    console.table(results.map(r => ({ corrida: r.label, isDeceased: r.isDeceased, finalMAP: r.finalMAP.toFixed(2) })));
    const outcomes = new Set(results.map(r => r.isDeceased));
    console.log(`Serie A — ${outcomes.size === 1 ? 'NO flipea' : 'FLIPEA'} (${outcomes.size} desenlaces distintos de ${results.length} corridas)`);
    expect(results.length).toBe(8);
  }, 3_000_000); // 8 corridas x 1800s sim a dt=1/240 — observado ~2M ms real

  it('Serie B — dt fijo=1/240, semilla fija, variar bloodVolume inicial', () => {
    const baseBV = 5000; // default de resetAllStores() — applySepsisSdra no llama setBloodVolume
    const pcts = [-1.0, -0.5, -0.2, 0.2, 0.5, 1.0];
    const results = pcts.map(pct => ({
      ...runOnce(BASE_SEED, BASE_DT, baseBV * (1 + pct / 100)),
      label: `bv${pct >= 0 ? '+' : ''}${pct}%`,
    }));
    console.log('\n=== Serie B — dt=1/240 fijo, semilla fija, volemia variable ===');
    console.table(results.map(r => ({ corrida: r.label, isDeceased: r.isDeceased, finalMAP: r.finalMAP.toFixed(2) })));
    const outcomes = new Set(results.map(r => r.isDeceased));
    console.log(`Serie B — ${outcomes.size === 1 ? 'NO flipea' : 'FLIPEA'} (${outcomes.size} desenlaces distintos de ${results.length} corridas)`);
    expect(results.length).toBe(6);
  }, 2_000_000); // 6 corridas x 1800s sim a dt=1/240 — observado ~1.5M ms real

  it('Serie C — semilla fija, bloodVolume fijo, variar dt', () => {
    const dts = [
      { label: 'x1  (dt=1/240)', dt: 1 / 240 },
      { label: 'x10 (dt=1/24)',  dt: 1 / 24 },
      { label: 'x60 (dt=0.25)',  dt: 0.25 },
    ];
    const results = dts.map(({ label, dt }) => ({
      ...runOnce(BASE_SEED, dt),
      label,
    }));
    console.log('\n=== Serie C — semilla fija, volemia fija, dt variable ===');
    console.table(results.map(r => ({ corrida: r.label, isDeceased: r.isDeceased, finalMAP: r.finalMAP.toFixed(2) })));
    const outcomes = new Set(results.map(r => r.isDeceased));
    console.log(`Serie C — ${outcomes.size === 1 ? 'NO flipea' : 'FLIPEA'} (${outcomes.size} desenlaces distintos de ${results.length} corridas)`);
    expect(results.length).toBe(3);
  }, 600_000);
});
