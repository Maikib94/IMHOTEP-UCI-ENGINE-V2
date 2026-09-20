// tests/diagnostics/dtInvariance.spec.ts
//
// C1.5 V4 (original) + C1.7-fix commit 1 (reescrito) — guard estructural:
// la fisica no debe depender de que velocidad de reproduccion eligio el
// usuario.
//
// HISTORIA: la version original de este test uso un reset parcial (4 de
// ~16 motores) y comparo solo DOS dt (x1, x60). C1.7-fix commit 1 corrige
// la causa raiz real (CardiovascularEngine.noiseTimer perdia el excedente
// al comparar contra un umbral con dt no representable exacto en binario
// — ver commit "fix(hemodynamics): separar deriva continua de FC del
// evento discreto de ruido" en este mismo ciclo). Este archivo ahora:
//   1. Usa resetAllEngines() (C1.7 commit 4) — reset completo, no parcial.
//   2. Compara TRES dt (x1, x10, x60), no solo dos — dos puntos no
//      detectan una dependencia no monotona.
//   3. Exige ademas identidad de DESENLACE DE MORTALIDAD entre las tres
//      corridas (criterio cualitativo duro, no solo tolerancia numerica).

import { describe, it, expect } from 'vitest';
import { usePatientStore, type Vitals } from '../../src/store/usePatientStore';
import { useMortalityStore } from '../../src/store/useMortalityStore';
import { CardiovascularEngine } from '../../src/core/CardiovascularEngine';
import { advanceSimSeconds } from '../helpers/timeAdvance';
import { resetEngines as resetEnginesAndStores } from '../helpers/dtBisectHarness';
import { applySepsisSdra } from '../fixtures/clinicalCases';

const FIELDS = [
  'pH', 'hco3', 'lactate', 'paO2', 'paCO2', 'spo2', 'etco2',
  'temperature', 'urineOutput', 'evlwi', 'heartRate', 'meanArterialPressure',
] as const satisfies readonly (keyof Vitals)[];

function snapshotVitals(): Record<(typeof FIELDS)[number], number> {
  const v = usePatientStore.getState().vitals;
  const snap = {} as Record<(typeof FIELDS)[number], number>;
  for (const f of FIELDS) snap[f] = v[f] as number;
  return snap;
}

function runAt(dt: number): { vitals: Record<(typeof FIELDS)[number], number>; isDeceased: boolean } {
  resetEnginesAndStores();
  applySepsisSdra();
  advanceSimSeconds(1800, dt);
  return {
    vitals: snapshotVitals(),
    isDeceased: useMortalityStore.getState().isDeceased,
  };
}

describe('C1.7-fix commit 1 — invarianza de dt (produccion x1 vs x10 vs x60)', () => {
  it('diverge <5% relativo entre dt=1/240, 1/24 y 0.25 tras 1800s sim (pH: tolerancia absoluta 0.03); mismo desenlace de mortalidad', () => {
    const runs = [
      { label: 'x1  (dt=1/240)', dt: 1 / 240 },
      { label: 'x10 (dt=1/24)',  dt: 1 / 24 },
      { label: 'x60 (dt=0.25)',  dt: 0.25 },
    ].map(r => ({ ...r, result: runAt(r.dt) }));

    console.log('=== Desenlace de mortalidad por dt ===');
    console.table(runs.map(r => ({ velocidad: r.label, isDeceased: r.result.isDeceased })));

    const outcomes = new Set(runs.map(r => r.result.isDeceased));
    const sameOutcome = outcomes.size === 1;
    if (!sameOutcome) {
      console.log('DESENLACE DE MORTALIDAD DIVERGENTE ENTRE VELOCIDADES — ver tabla arriba.');
    }

    // Comparacion numerica: cada par de corridas contra la referencia fina (x1)
    const reference = runs[0].result.vitals;
    const rows: Array<{
      velocidad: string; campo: string; fine: number; corrida: number;
      diffAbs: number; diffRelPct: number; tolerancia: string; pass: boolean;
    }> = [];

    for (const r of runs.slice(1)) {
      for (const f of FIELDS) {
        const fine = reference[f], val = r.result.vitals[f];
        const diffAbs = Math.abs(fine - val);
        const diffRel = fine !== 0 ? diffAbs / Math.abs(fine) : (val === 0 ? 0 : Infinity);
        const isPH = f === 'pH';
        const pass = isPH ? diffAbs < 0.03 : diffRel < 0.05;
        rows.push({
          velocidad: r.label, campo: f, fine, corrida: val, diffAbs,
          diffRelPct: isFinite(diffRel) ? diffRel * 100 : Infinity,
          tolerancia: isPH ? 'abs<0.03' : 'rel<5%',
          pass,
        });
      }
    }

    console.table(rows);

    const failures = rows.filter(r => !r.pass);
    if (failures.length > 0) {
      console.log(
        'CAMPOS QUE DIVERGEN MAS ALLA DE TOLERANCIA (fisica dependiente de dt):\n' +
        failures.map(f =>
          `  [${f.velocidad}] ${f.campo}: fine=${f.fine.toFixed(4)} corrida=${f.corrida.toFixed(4)} ` +
          `diffAbs=${f.diffAbs.toFixed(4)} diffRel=${f.diffRelPct.toFixed(2)}%`
        ).join('\n')
      );
    }

    // HALLAZGO REAL (no se ajusta la tolerancia para forzar el pase, mismo
    // criterio que el resto de este archivo): este fixture severo
    // (applySepsisSdra, 1800s) SIGUE divergiendo en desenlace de mortalidad
    // entre dt=1/240 (muere) y dt=1/24,0.25 (sobrevive), incluso DESPUES de
    // C1.9 commits 1 (semantica de reloj) y 2 (streams de RNG aislados).
    //
    // ACTUALIZACION C1.9 commit 3 (ver tests/diagnostics/
    // separatrixDiscriminant.spec.ts): CORREGIDA la especulacion anterior
    // de que esto pudiera ser una separatriz genuina. El experimento
    // discriminante de 3 series prueba lo contrario — el fixture es
    // COMPLETAMENTE ROBUSTO a semilla de RNG (8/8 corridas mueren igual a
    // dt=1/240 fijo) y a volemia inicial (6/6 corridas mueren igual, ±0.2-
    // 1%) — SOLO variar dt cambia el desenlace. Veredicto explicito: NO ES
    // SEPARATRIZ. Es una dependencia de dt RESIDUAL real, reproducible —
    // un bug numerico en algun motor, pendiente de re-bisecar bajo el
    // harness ahora deterministico (propuesto por escrito para un PR
    // posterior, no implementado aqui). Se deja este test FALLANDO
    // intencionalmente como evidencia, no se relaja.
    expect(sameOutcome, 'el desenlace de mortalidad debe ser identico entre x1/x10/x60').toBe(true);
    expect(failures.map(f => `${f.velocidad}:${f.campo}`)).toEqual([]);
  }, 900_000);
});

describe('C1.7-fix commit 1 — verificacion de TAU_HR_S (la deriva continua preserva la calibracion previa)', () => {
  it('tiempo hasta 63% del gap inicial de 30 bpm ≈ 19.5s sim (±10%), identico independiente de dt', () => {
    // Neutralizar el ruido de medicion (Math.random) para medir la deriva
    // pura sin contaminar con el termino estocastico ±1 bpm.
    const originalRandom = Math.random;
    Math.random = () => 0.5; // pendingNoise = 0.5*2-1 = 0

    function measureTimeTo63Pct(dt: number): number {
      resetEnginesAndStores();
      // Paciente sano, sin sepsis/drogas — targetHR converge a ~HR_BASE (75).
      usePatientStore.getState().updateVitals({ heartRate: 45 }); // gap = 30
      usePatientStore.getState().setVentilatorConnected(false);
      const cv = CardiovascularEngine.getInstance();
      const target63 = 45 + 30 * 0.63; // = 63.9

      let t = 0;
      const MAX_T = 120;
      while (t < MAX_T) {
        cv.updateHemodynamics(dt);
        t += dt;
        const hr = usePatientStore.getState().vitals.heartRate;
        if (hr >= target63) return t;
      }
      return -1; // no convergio
    }

    try {
      const tFine = measureTimeTo63Pct(1 / 240);
      const tCoarse = measureTimeTo63Pct(0.25);

      console.log(`Tiempo a 63% del gap — dt=1/240: ${tFine.toFixed(3)}s | dt=0.25: ${tCoarse.toFixed(3)}s | esperado: ~19.5s`);

      expect(tFine).toBeGreaterThan(0);
      expect(tCoarse).toBeGreaterThan(0);
      expect(Math.abs(tFine - 19.4957) / 19.4957).toBeLessThan(0.10);
      expect(Math.abs(tCoarse - 19.4957) / 19.4957).toBeLessThan(0.10);
      expect(Math.abs(tFine - tCoarse) / tFine).toBeLessThan(0.10);
    } finally {
      Math.random = originalRandom;
    }
  }, 30_000);
});
