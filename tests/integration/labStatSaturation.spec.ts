// tests/integration/labStatSaturation.spec.ts
//
// C6 commit 1 (1d, 1e, 1f) — verifica la logica de prioridad STAT,
// saturacion y modo docente sin depender de UI.

import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore } from '../../src/store/usePatientStore';
import { useTimeStore } from '../../src/store/useTimeStore';
import { LabEngine } from '../../src/core/LabEngine';
import { resetAllStores } from '../helpers/storeReset';

function pendingOf(type: string) {
  return usePatientStore.getState().labOrders.find(o => o.type === type && o.result === null)!;
}

beforeEach(() => {
  resetAllStores();
  LabEngine.getInstance().reset();
});

describe('C6 commit 1 — STAT / saturacion / modo docente', () => {
  it('1f — turnaround nominal recalibrado (lactato 7min, gases 12min)', () => {
    LabEngine.getInstance().placeOrder('lactate');
    LabEngine.getInstance().placeOrder('abg');
    const lac = pendingOf('lactate');
    const abg = pendingOf('abg');
    expect(lac.readyAt - lac.orderedAt).toBe(7 * 60);
    expect(abg.readyAt - abg.orderedAt).toBe(12 * 60);
  });

  it('1d — urgente aplica 0.45x sobre el nominal', () => {
    // coag nominal = 52 min = 3120s; urgente = 3120*0.45 = 1404s (> piso de 8min)
    LabEngine.getInstance().placeOrder('coag', 'urgente');
    const o = pendingOf('coag');
    expect(o.baseProcessingTimeS).toBeCloseTo(52 * 60 * 0.45, 5);
    expect(o.readyAt - o.orderedAt).toBeCloseTo(52 * 60 * 0.45, 5);
  });

  it('1d — urgente respeta el piso de 8 min aunque 0.45x del nominal sea menor', () => {
    // lactato nominal = 7min = 420s; 420*0.45=189s (<480s) → debe usar el piso
    LabEngine.getInstance().placeOrder('lactate', 'urgente');
    const o = pendingOf('lactate');
    expect(o.baseProcessingTimeS).toBe(8 * 60);
  });

  it('1d — 4 urgentes simultaneos NO tienen penalidad de saturacion', () => {
    for (const t of ['lactate', 'abg', 'glucose_r', 'cbc']) {
      LabEngine.getInstance().placeOrder(t, 'urgente');
    }
    for (const t of ['lactate', 'abg', 'glucose_r', 'cbc']) {
      const o = pendingOf(t);
      expect(o.readyAt - o.orderedAt).toBe(o.baseProcessingTimeS); // multiplicador 1.0
    }
  });

  it('1d — el 5to urgente simultaneo penaliza +15% a TODOS los urgentes activos', () => {
    for (const t of ['lactate', 'abg', 'glucose_r', 'cbc']) {
      LabEngine.getInstance().placeOrder(t, 'urgente');
    }
    const lacBefore = pendingOf('lactate');
    const baseLac = lacBefore.baseProcessingTimeS;
    expect(lacBefore.readyAt - lacBefore.orderedAt).toBe(baseLac); // aun sin penalidad

    // 5to urgente — dispara la saturacion (1 "extra" mas alla de 4)
    LabEngine.getInstance().placeOrder('coag', 'urgente');

    const lacAfter = pendingOf('lactate');
    const coag = pendingOf('coag');
    // multiplicador = 1 + 0.15*1 = 1.15, aplicado a TODOS (incluido el ya existente)
    expect(lacAfter.readyAt - lacAfter.orderedAt).toBeCloseTo(baseLac * 1.15, 5);
    expect(coag.readyAt - coag.orderedAt).toBeCloseTo(coag.baseProcessingTimeS * 1.15, 5);
  });

  it('1d — al completarse un urgente, la saturacion de los restantes se reduce', () => {
    for (const t of ['lactate', 'abg', 'glucose_r', 'cbc', 'coag']) {
      LabEngine.getInstance().placeOrder(t, 'urgente');
    }
    // Adelantar el tiempo hasta que 'lactate' (el mas corto, con penalidad) complete.
    const lac = pendingOf('lactate');
    useTimeStore.setState({ simulatedElapsed: lac.readyAt });
    LabEngine.getInstance().update();

    // Quedan 4 urgentes activos — sin penalidad — coag deberia volver a su base.
    const coag = pendingOf('coag');
    expect(coag.readyAt - coag.orderedAt).toBeCloseTo(coag.baseProcessingTimeS, 5);
  });

  it('1e — modo docente (labTurnaroundFactor) acelera el turnaround nominal', () => {
    usePatientStore.getState().setLabTurnaroundFactor(0.25);
    LabEngine.getInstance().placeOrder('lactate');
    const o = pendingOf('lactate');
    expect(o.readyAt - o.orderedAt).toBeCloseTo(7 * 60 * 0.25, 5);
  });

  it('1e — labTurnaroundFactor default es 1.0 (no es el default de produccion)', () => {
    expect(usePatientStore.getState().labTurnaroundFactor).toBe(1.0);
  });
});
