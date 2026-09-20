// tests/diagnostics/clockSemantics.spec.ts
//
// C1.7-fix commit 3 — auditoria de semantica de reloj (diagnostico puro,
// NO se corrige nada aqui — ver reporte para el veredicto CONFIRMADA/
// DESCARTADA y la lista completa de consumidores de useTimeStore.ticks).
//
// useTimeStore mantiene DOS relojes con semantica DISTINTA:
//   ticks            → contador entero, +1 por cada llamada a
//                       CronosEngine.tick(). El loop de CronosEngine
//                       ejecuta ticksToRun = floor(accumulator), donde
//                       accumulator se alimenta de TIEMPO REAL transcurrido
//                       (timestamp - lastTime) × TICKS_PER_REAL_SECOND(240)
//                       — cantidad INDEPENDIENTE de speedMultiplier.
//                       ⇒ ticks avanza a ~240/segundo REAL SIEMPRE, sin
//                       importar la velocidad de reproduccion elegida.
//   simulatedElapsed → +dt por tick, dt = DT_BASE(1/240) × speedMultiplier
//                       ⇒ esta es la que representa SEGUNDOS SIMULADOS
//                       reales (lo que un reloj de paciente marcaria).
//
// Varios consumidores (confirmado por lectura directa del codigo, no por
// suposicion) escriben `algo: ticks + horas*3600` esperando que eso
// equivalga a "horas de tiempo SIMULADO despues" — pero como ticks no
// escala con dt, la cantidad de tiempo SIMULADO real que transcurre hasta
// que esa condicion se cumple depende de la velocidad, y a x1 (dt=1/240)
// difiere del nominal por un factor de exactamente 240.
//
// Este archivo REPLICA (no importa) la logica exacta de cada mecanismo
// para medirla sin correr el motor fisiologico completo (mucho mas rapido,
// y aisla la variable relevante).

import { describe, it, expect } from 'vitest';
import { useTimeStore } from '../../src/store/useTimeStore';

function resetTime(): void {
  useTimeStore.getState().reset();
}

// ─── 1. HGT programado (CronosEngine.tick(), replica exacta) ────────────────
//    src/core/CronosEngine.ts:139-164
function measureHGT(dt: number, intervalH: number): number {
  resetTime();
  let nextHgtTick: number | null = null;
  // ticks avanza +1 por llamada SIN IMPORTAR dt — el limite de iteraciones
  // necesarias no escala con dt, solo con el umbral nominal en "ticks".
  const maxTicks = intervalH * 3600 + 1000;
  for (let i = 0; i < maxTicks; i++) {
    useTimeStore.getState().advanceTick(dt);
    const currentTick = useTimeStore.getState().ticks;
    if (nextHgtTick === null) {
      nextHgtTick = currentTick + intervalH * 3600;
    } else if (currentTick >= nextHgtTick) {
      return useTimeStore.getState().simulatedElapsed;
    }
  }
  return -1; // no disparo dentro del limite
}

// ─── 2. Dosis programada (usePharmacologyStore.scheduleDose +
//    CronosEngine.tick() consumer, replica exacta) ───────────────────────────
//    src/store/usePharmacologyStore.ts:1047-1057
//    src/core/CronosEngine.ts:166-180
function measureScheduledDose(dt: number, intervalH: number): number {
  resetTime();
  const tickNow = useTimeStore.getState().ticks; // 0
  const nextTickAt = tickNow + intervalH * 3600;
  const maxTicks = intervalH * 3600 + 1000;
  for (let i = 0; i < maxTicks; i++) {
    useTimeStore.getState().advanceTick(dt);
    if (useTimeStore.getState().ticks >= nextTickAt) {
      return useTimeStore.getState().simulatedElapsed;
    }
  }
  return -1;
}

// ─── 3. Turnaround de laboratorio (LabEngine.placeOrder, replica exacta) ────
//    src/core/LabEngine.ts:328-329 — usa simulatedElapsed, NO ticks.
function measureLabTurnaround(dt: number, processingTimeS: number): number {
  resetTime();
  const orderedAt = useTimeStore.getState().simulatedElapsed; // 0
  const readyAt = orderedAt + processingTimeS;
  const maxTicks = Math.round(processingTimeS * 3 / dt);
  for (let i = 0; i < maxTicks; i++) {
    useTimeStore.getState().advanceTick(dt);
    if (useTimeStore.getState().simulatedElapsed >= readyAt) {
      return useTimeStore.getState().simulatedElapsed;
    }
  }
  return -1;
}

describe('C1.7-fix commit 3 — medicion empirica de semantica de reloj', () => {
  it('HGT programado cada 1h — segundos SIMULADOS reales hasta el primer disparo', () => {
    const nominalS = 3600;
    const atX1  = measureHGT(1 / 240, 1);
    const atX60 = measureHGT(0.25, 1);
    const factorX1  = atX1 / nominalS;
    const factorX60 = atX60 / nominalS;
    console.log(`HGT 1h — nominal=${nominalS}s | x1(dt=1/240)=${atX1.toFixed(2)}s (factor ${factorX1.toFixed(1)}x) | x60(dt=0.25)=${atX60.toFixed(2)}s (factor ${factorX60.toFixed(1)}x)`);
    expect(atX1).toBeGreaterThan(0);
  }, 60_000);

  it('Dosis programada cada 1h — segundos SIMULADOS reales hasta el primer disparo', () => {
    const nominalS = 3600;
    const atX1  = measureScheduledDose(1 / 240, 1);
    const atX60 = measureScheduledDose(0.25, 1);
    const factorX1  = atX1 / nominalS;
    const factorX60 = atX60 / nominalS;
    console.log(`Dosis 1h — nominal=${nominalS}s | x1(dt=1/240)=${atX1.toFixed(2)}s (factor ${factorX1.toFixed(1)}x) | x60(dt=0.25)=${atX60.toFixed(2)}s (factor ${factorX60.toFixed(1)}x)`);
    expect(atX1).toBeGreaterThan(0);
  }, 60_000);

  it('Turnaround de laboratorio (ABG, 1800s nominal) — segundos SIMULADOS reales', () => {
    const nominalS = 1800;
    const atX1  = measureLabTurnaround(1 / 240, nominalS);
    const atX60 = measureLabTurnaround(0.25, nominalS);
    console.log(`Lab ABG — nominal=${nominalS}s | x1(dt=1/240)=${atX1.toFixed(2)}s | x60(dt=0.25)=${atX60.toFixed(2)}s`);
    // LabEngine usa simulatedElapsed (correcto) — se espera exactitud en ambos dt.
    expect(Math.abs(atX1 - nominalS)).toBeLessThan(1);
    expect(Math.abs(atX60 - nominalS)).toBeLessThan(0.25);
  }, 30_000);

  it('Alarma PiCCO 8h sin recalibrar — segundos SIMULADOS reales hasta disparo', () => {
    // src/core/CronosEngine.ts:201-206 — misma logica que HGT/dosis (ticks - ticks >= umbral en "segundos")
    const nominalS = 8 * 3600;
    function measurePiccoAlarm(dt: number): number {
      resetTime();
      const lastThermodilutionTick = useTimeStore.getState().ticks; // 0
      const eightHoursS = 8 * 3600;
      const maxTicks = eightHoursS + 1000; // ticks-based — no escala con dt
      for (let i = 0; i < maxTicks; i++) {
        useTimeStore.getState().advanceTick(dt);
        const ticksSince = useTimeStore.getState().ticks - lastThermodilutionTick;
        if (ticksSince >= eightHoursS) return useTimeStore.getState().simulatedElapsed;
      }
      return -1;
    }
    const atX1  = measurePiccoAlarm(1 / 240);
    const atX60 = measurePiccoAlarm(0.25);
    console.log(`Alarma PiCCO 8h — nominal=${nominalS}s | x1(dt=1/240)=${atX1.toFixed(2)}s (factor ${(atX1 / nominalS).toFixed(3)}x) | x60(dt=0.25)=${atX60.toFixed(2)}s (factor ${(atX60 / nominalS).toFixed(3)}x)`);
    expect(atX1).toBeGreaterThan(0);
  }, 30_000);
});
