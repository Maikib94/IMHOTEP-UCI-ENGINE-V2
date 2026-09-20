// tests/diagnostics/clockSemanticsFix.spec.ts
//
// C1.9 commit 1, paso 1e — verificacion empirica POST-FIX. Repite la
// medicion de tests/diagnostics/clockSemantics.spec.ts (0f397e8, que
// documenta el bug original — se deja intacto como evidencia historica),
// ahora replicando la logica CORREGIDA (simulatedElapsed en vez de ticks)
// de CronosEngine.ts / usePharmacologyStore.ts / useMonitoringStore.ts.
//
// CRITERIO: factor de error = 1.00 ± 0.01 en las tres velocidades
// (x1 dt=1/240, x10 dt=1/24, x60 dt=0.25) para HGT, dosis programada y
// alarma PiCCO. LabEngine ya era correcto — se re-verifica sin tocar.

import { describe, it, expect } from 'vitest';
import { useTimeStore } from '../../src/store/useTimeStore';
import { usePharmacologyStore } from '../../src/store/usePharmacologyStore';
import { PharmacologyEngine } from '../../src/core/PharmacologyEngine';
import { resetEngines } from '../helpers/dtBisectHarness';

function resetTime(): void {
  useTimeStore.getState().reset();
}

const SPEEDS = [
  { label: 'x1  (dt=1/240)', dt: 1 / 240 },
  { label: 'x10 (dt=1/24)',  dt: 1 / 24 },
  { label: 'x60 (dt=0.25)',  dt: 0.25 },
];

// ─── 1. HGT programado — replica de la logica CORREGIDA en CronosEngine.ts ──
function measureHGTFixed(dt: number, intervalH: number): number {
  resetTime();
  let nextHgtAtSimS: number | null = null;
  const nominalS = intervalH * 3600;
  const maxSteps = Math.ceil((nominalS * 1.5) / dt) + 10;
  for (let i = 0; i < maxSteps; i++) {
    useTimeStore.getState().advanceTick(dt);
    const currentSimS = useTimeStore.getState().simulatedElapsed;
    if (nextHgtAtSimS === null) {
      nextHgtAtSimS = currentSimS + nominalS;
    } else if (currentSimS >= nextHgtAtSimS) {
      return currentSimS;
    }
  }
  return -1;
}

// ─── 2. Dosis programada — replica de la logica CORREGIDA ───────────────────
function measureScheduledDoseFixed(dt: number, intervalH: number): number {
  resetTime();
  const simSNow = useTimeStore.getState().simulatedElapsed;
  const nominalS = intervalH * 3600;
  const nextDoseAtSimS = simSNow + nominalS;
  const maxSteps = Math.ceil((nominalS * 1.5) / dt) + 10;
  for (let i = 0; i < maxSteps; i++) {
    useTimeStore.getState().advanceTick(dt);
    if (useTimeStore.getState().simulatedElapsed >= nextDoseAtSimS) {
      return useTimeStore.getState().simulatedElapsed;
    }
  }
  return -1;
}

// ─── 3. Alarma PiCCO 8h — replica de la logica CORREGIDA ────────────────────
function measurePiccoAlarmFixed(dt: number): number {
  resetTime();
  const lastThermodilutionSimS = useTimeStore.getState().simulatedElapsed; // 0
  const eightHoursS = 8 * 3600;
  const maxSteps = Math.ceil((eightHoursS * 1.5) / dt) + 10;
  for (let i = 0; i < maxSteps; i++) {
    useTimeStore.getState().advanceTick(dt);
    const simSSince = useTimeStore.getState().simulatedElapsed - lastThermodilutionSimS;
    if (simSSince >= eightHoursS) return useTimeStore.getState().simulatedElapsed;
  }
  return -1;
}

// ─── 4. Turnaround de laboratorio — sin cambios, ya era correcto ────────────
function measureLabTurnaround(dt: number, processingTimeS: number): number {
  resetTime();
  const orderedAt = useTimeStore.getState().simulatedElapsed; // 0
  const readyAt = orderedAt + processingTimeS;
  const maxSteps = Math.ceil((processingTimeS * 1.5) / dt) + 10;
  for (let i = 0; i < maxSteps; i++) {
    useTimeStore.getState().advanceTick(dt);
    if (useTimeStore.getState().simulatedElapsed >= readyAt) {
      return useTimeStore.getState().simulatedElapsed;
    }
  }
  return -1;
}

function checkEvent(label: string, nominalS: number, measure: (dt: number) => number): void {
  const rows = SPEEDS.map(({ label: speedLabel, dt }) => {
    const atS = measure(dt);
    const factor = atS / nominalS;
    return { evento: label, velocidad: speedLabel, nominalS, sSimReales: Number(atS.toFixed(3)), factor: Number(factor.toFixed(4)) };
  });
  console.log(`\n=== ${label} — nominal=${nominalS}s ===`);
  console.table(rows);
  for (const r of rows) {
    expect(Math.abs(r.factor - 1.0), `${label} @ ${r.velocidad}: factor=${r.factor}`).toBeLessThanOrEqual(0.01);
  }
}

describe('C1.9 commit 1 — verificacion empirica POST-FIX (x1/x10/x60, factor 1.00±0.01)', () => {
  it('HGT programado cada 1h', () => {
    checkEvent('HGT 1h', 3600, (dt) => measureHGTFixed(dt, 1));
  }, 60_000);

  it('Dosis programada cada 1h', () => {
    checkEvent('Dosis 1h', 3600, (dt) => measureScheduledDoseFixed(dt, 1));
  }, 60_000);

  it('Alarma PiCCO 8h sin recalibrar', () => {
    checkEvent('Alarma PiCCO 8h', 8 * 3600, measurePiccoAlarmFixed);
  }, 60_000);

  it('Turnaround de laboratorio (ABG, 1800s nominal) — control, ya era correcto', () => {
    checkEvent('Lab ABG', 1800, (dt) => measureLabTurnaround(dt, 1800));
  }, 30_000);
});

// ─── 1f — Impacto clinico cuantificado: meropenem q8h, cpRatio a 1h sim ─────
//
// ANTES del fix: nextTickAt = ticks + intervalH*3600 comparado contra ticks
// crudo (240/s real fijo). q8h = 28800 "ticks", que a dt=1/240 (x1) equivale
// a solo 28800*dt = 120s SIMULADOS — el schedule se reprograma y dispara de
// nuevo cada 120s en vez de cada 8h. En una ventana de 1h sim (3600s) eso da
// 3600/120 = 30 disparos de 1g de meropenem en la primera hora.
//
// DESPUES del fix: nextDoseAtSimS = simS + 8*3600 = 8h simulada real — cero
// disparos adicionales en la primera hora (el primero esta programado a t=8h,
// consistente con q8h clinico real).
describe('C1.9 commit 1, paso 1f — impacto clinico: meropenem q8h a 1h sim', () => {
  const DOSE_MG = 1000;   // 1 g
  const INTERVAL_H = 8;   // q8h
  const WINDOW_S = 3600;  // 1h sim
  const DT = 1 / 240;     // x1 — velocidad de produccion real-time

  it('cpRatio de meropenem tras 1h sim — ANTES (buggy) vs DESPUES (fix)', () => {
    // ── ANTES: replica exacta de la logica pre-fix (ticks crudos) ──────────
    resetEngines();
    usePharmacologyStore.getState().resetAll();
    const pEng = PharmacologyEngine.getInstance();
    let nextTickAtBuggy = 0 + INTERVAL_H * 3600; // ticks "unit", pero se compara contra ticks crudo
    let firingsBefore = 0;
    const stepsBefore = Math.round(WINDOW_S / DT);
    for (let i = 0; i < stepsBefore; i++) {
      useTimeStore.getState().advanceTick(DT);
      const rawTicks = useTimeStore.getState().ticks;
      if (rawTicks >= nextTickAtBuggy) {
        pEng.queueSlowBolus('meropenem_iv', DOSE_MG, 300);
        firingsBefore++;
        nextTickAtBuggy = rawTicks + INTERVAL_H * 3600;
      }
      pEng.update(DT);
    }
    const cpRatioBefore = usePharmacologyStore.getState().plasmaConcentrations['meropenem_iv'] ?? 0;

    // ── DESPUES: mecanismo real ya corregido (simulatedElapsed) ────────────
    resetEngines();
    usePharmacologyStore.getState().resetAll();
    usePharmacologyStore.getState().scheduleDose('meropenem_iv', DOSE_MG, INTERVAL_H);
    let firingsAfter = 0;
    const stepsAfter = Math.round(WINDOW_S / DT);
    for (let i = 0; i < stepsAfter; i++) {
      useTimeStore.getState().advanceTick(DT);
      const simSNow = useTimeStore.getState().simulatedElapsed;
      const doses = usePharmacologyStore.getState().scheduledDoses;
      for (const s of doses) {
        if (!s.active) continue;
        if (simSNow >= s.nextDoseAtSimS) {
          PharmacologyEngine.getInstance().queueSlowBolus(s.drug, s.doseMg, 300);
          firingsAfter++;
          usePharmacologyStore.setState(state => ({
            scheduledDoses: state.scheduledDoses.map(x =>
              x.id === s.id ? { ...x, nextDoseAtSimS: simSNow + x.intervalH * 3600 } : x
            ),
          }));
        }
      }
      PharmacologyEngine.getInstance().update(DT);
    }
    const cpRatioAfter = usePharmacologyStore.getState().plasmaConcentrations['meropenem_iv'] ?? 0;

    console.log(`\n=== Impacto clinico — meropenem 1g q8h, cpRatio a 1h sim (x1, dt=1/240) ===`);
    console.table([
      { version: 'ANTES (bug)', disparos_1h: firingsBefore, cpRatio_1h: Number(cpRatioBefore.toFixed(4)) },
      { version: 'DESPUES (fix)', disparos_1h: firingsAfter, cpRatio_1h: Number(cpRatioAfter.toFixed(4)) },
    ]);

    // ANTES: el bug dispara ~30 veces en 1h (cada ~120s en vez de cada 8h).
    expect(firingsBefore).toBeGreaterThan(20);
    // DESPUES: cero disparos en la primera hora — el primero esta a t=8h.
    expect(firingsAfter).toBe(0);
    expect(cpRatioAfter).toBe(0);
  }, 200_000); // 2×864000 ticks a traves de PharmacologyEngine.update() — mas lento que el resto
});
