// tests/diagnostics/determinism.spec.ts
//
// C1.7 commit 4 — prueba de determinismo, obligatoria ANTES de bisecar
// (dtBisect.spec.ts, commit 5).
//
// HISTORIA: la version de C1.7 commit 3 de este archivo solo reseteaba 4
// de ~16 motores singleton (RespiratoryEngine, AcidBaseEngine,
// PharmacologyEngine, AcuteMortalityEngine) y comparaba solo el ESTADO
// FINAL tras 1800s. Fallo con divergencias del orden de 1e-8 relativo, y
// se interpreto (incorrectamente) como no-asociatividad de punto flotante
// o variacion de JIT entre corridas del mismo proceso V8.
//
// Esa hipotesis es incorrecta: ECMAScript exige redondeo IEEE 754 exacto
// para aritmetica basica — un build de V8 dado devuelve los mismos bits
// para la misma entrada siempre, y el tiering del JIT no altera
// resultados. Ademas 1e-8 esta ocho ordenes de magnitud por encima del
// epsilon de doble (2.2e-16). La causa real: los singletons de motor
// arrastran estado privado entre corridas (CardiovascularEngine —
// noiseTimer/pendingNoise/treatmentRecovery/recoveryElapsed — nunca se
// reseteaba; la corrida 2 heredaba fase de ruido de FC de la corrida 1,
// aunque el RNG estuviera sembrado igual). Auditoria completa + reset()
// para los 16 motores + resetAllEngines() → C1.7 commit 4.
//
// Este archivo ahora:
//   1. Usa resetEngines() del harness compartido (resetAllStores() +
//      resetAllEngines() — TODOS los singletons, no un subconjunto).
//   2. Compara la SERIE TEMPORAL completa (muestreada cada 1s simulado),
//      no solo el estado final — un campo podria divergir y re-converger
//      por casualidad hacia el final de la ventana.
//   3. Exige identidad EXACTA (===), no tolerancia.
//
// Si este test falla, TODO lo que sigue (dtBisect.spec.ts) es ruido —
// no se puede distinguir "diverge por dt" de "diverge por estado
// residual" sin esta garantia primero.

import { describe, it, expect } from 'vitest';
import { applySepsisSdra } from '../fixtures/clinicalCases';
import { runSampled, exactMismatches, FULL_CHAIN } from '../helpers/dtBisectHarness';

const SEED = 1337;
const DURATION_S = 600; // ventana identica a 3B/3C de dtBisect.spec.ts

describe('C1.7 commit 4 — prueba de determinismo (obligatoria antes de bisecar)', () => {
  it('mismo escenario, mismo dt, misma semilla → identidad exacta (===) en toda la serie temporal', () => {
    const run1 = runSampled(1 / 240, DURATION_S, FULL_CHAIN, applySepsisSdra, SEED);
    const run2 = runSampled(1 / 240, DURATION_S, FULL_CHAIN, applySepsisSdra, SEED);

    const mismatches = exactMismatches(run1, run2);

    if (mismatches.length > 0) {
      console.log(
        `CAMPOS NO DETERMINISTAS (${mismatches.length} mismatches de ${run1.length} muestras × ${11} campos):\n` +
        mismatches.slice(0, 40).join('\n') +
        (mismatches.length > 40 ? `\n… (+${mismatches.length - 40} mas)` : ''),
      );
    }
    expect(mismatches).toEqual([]);
  }, 300_000);
});
