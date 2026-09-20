// tests/integration/ventilatorMechanics.spec.ts
//
// Integracion del motor SM100: balance de volumenes, disparo en modos
// asistidos-controlados y dependencia del drive respiratorio con el estado
// del paciente. Corre el motor de verdad, no la mecanica de asincronia en
// aislado (eso vive en tests/unit/ventilatorAsynchrony.spec.ts).

import { describe, it, expect, afterAll } from 'vitest';
import {
  VentilatorSM100Engine, deriveMechanicsFromPathology,
  type SM100Settings, type PatientMechanics,
} from '../../src/core/VentilatorSM100Engine';
import { resetRng } from '../../src/core/rng';

function settings(over: Partial<SM100Settings> = {}): SM100Settings {
  return {
    mode: 'VCV', fio2: 0.4, peep: 5, vtTarget: 500, rrSet: 14,
    pInspSet: 15, pSupport: 10, tInspSet: 1.0, pMaxAlarm: 40,
    atrcEnabled: false, atrcTubeId: 8.0, atrcCompensation: 0,
    triggerType: 'flow', flowTriggerLpm: 2, pressTriggerCmH2O: 2,
    amvMinuteVentTarget: 7, amvWeightKg: 70,
    flowPatternVCV: 'square',
    ...over,
  };
}

/** Paciente pasivo con mecanica normal — sin esfuerzo, sin obstruccion. */
function passive(over: Partial<PatientMechanics> = {}): PatientMechanics {
  return {
    crs: 50, raw: 5, eCw_eTot: 0.7,
    pMusAmplitude: 0, pMusDriveHz: 14 / 60, vAnat: 154,
    ...over,
  };
}

/** Corre `seconds` de simulacion en pasos de 10 ms. */
function run(eng: VentilatorSM100Engine, s: SM100Settings, m: PatientMechanics, seconds: number) {
  const dt = 0.01;
  for (let i = 0; i < Math.round(seconds / dt); i++) eng.update(dt, s, m);
}

// Este archivo no siembra el RNG: los tests de drive son funciones puras y
// los del motor no dependen del azar salvo por el auto-disparo, cuya
// probabilidad por respiracion es despreciable. Sembrarlo aqui dejaba el
// estado global del stream alterado para los archivos que comparten worker
// —CardiovascularEngine saca de ahi el ruido de FC— y eso descalibraba el
// fixture de acidosis lactica de acidbase.ownership, que vive al filo.
afterAll(() => resetRng());

describe('Balance de volumenes', () => {
  it('sin atrapamiento, el volumen espirado iguala al inspirado', () => {
    const eng = VentilatorSM100Engine.getInstance();
    eng.reset(5);
    const s = settings();
    run(eng, s, passive(), 30);

    const b = eng.getLastBreath();
    expect(b.breathId).toBeGreaterThan(3);
    expect(b.vtInsp).toBeGreaterThan(100);

    // Antes de corregir la doble integracion en espiracion, VTe salia ~26 %
    // por debajo de VTi y el panel lo mostraba como una fuga inexistente.
    const leak = (b.vtInsp - b.vtExp) / b.vtInsp;
    expect(leak).toBeLessThan(0.05);
  });

  it('la obstruccion severa si deja volumen atrapado y genera auto-PEEP', () => {
    const eng = VentilatorSM100Engine.getInstance();
    eng.reset(5);
    // Raw muy alta + frecuencia alta = tiempo espiratorio insuficiente.
    const s = settings({ rrSet: 30, tInspSet: 0.8 });
    run(eng, s, passive({ raw: 35, crs: 60 }), 30);

    const b = eng.getLastBreath();
    expect(b.autoPeep).toBeGreaterThan(0.5);
    // Y el atrapamiento se refleja en un VTe por debajo del VTi.
    expect(b.vtExp).toBeLessThan(b.vtInsp);
  });
});

describe('Disparo en modos asistidos-controlados', () => {
  it('el paciente puede disparar en VCV — es asistida-controlada, no controlada pura', () => {
    const eng = VentilatorSM100Engine.getInstance();
    eng.reset(5);
    // Drive rapido: si el paciente dispara, la frecuencia resultante supera
    // la programada. Antes checkTrigger devolvia false en VCV sin mirar nada.
    const s = settings({ mode: 'VCV', rrSet: 10 });
    run(eng, s, passive({ pMusAmplitude: 9, pMusDriveHz: 30 / 60 }), 40);

    const b = eng.getLastBreath();
    const rrDelivered = 60 / Math.max(0.01, b.tCycle);
    expect(rrDelivered).toBeGreaterThan(10);
  });

  it('un paciente paralizado no dispara: la frecuencia queda en la programada', () => {
    const eng = VentilatorSM100Engine.getInstance();
    eng.reset(5);
    const s = settings({ mode: 'VCV', rrSet: 10 });
    run(eng, s, passive({ pMusAmplitude: 0 }), 40);

    const b = eng.getLastBreath();
    const rrDelivered = 60 / Math.max(0.01, b.tCycle);
    expect(rrDelivered).toBeLessThan(13);
  });
});

describe('Drive respiratorio segun el estado del paciente', () => {
  const base = {
    ardsActive: false, ardsSeverity: 0,
    sepsisActive: false, sepsisSeverity: 0,
    hypovolemicFraction: 0, isSedated: false, nmbaFraction: 0,
  };

  it('el bloqueo neuromuscular anula el esfuerzo', () => {
    const m = deriveMechanicsFromPathology({ ...base, nmbaFraction: 0.9 });
    expect(m.pMusAmplitude).toBe(0);
  });

  it('la sedacion deprime el esfuerzo de forma graduada, no binaria', () => {
    const awake = deriveMechanicsFromPathology({ ...base, sedationDepth: 0 });
    const light = deriveMechanicsFromPathology({ ...base, sedationDepth: 0.4 });
    const deep  = deriveMechanicsFromPathology({ ...base, sedationDepth: 0.95 });
    expect(light.pMusAmplitude).toBeLessThan(awake.pMusAmplitude);
    expect(deep.pMusAmplitude).toBeLessThan(light.pMusAmplitude);
    expect(deep.pMusAmplitude).toBeGreaterThan(0);  // sedado no es paralizado
  });

  it('la acidemia aumenta el drive — estimulo ventilatorio mas potente', () => {
    const normal   = deriveMechanicsFromPathology({ ...base, pH: 7.40 });
    const acidotic = deriveMechanicsFromPathology({ ...base, pH: 7.15 });
    expect(acidotic.pMusAmplitude).toBeGreaterThan(normal.pMusAmplitude);
    expect(acidotic.pMusDriveHz).toBeGreaterThan(normal.pMusDriveHz);
  });

  it('la hipoxemia grave aumenta el drive', () => {
    const normal  = deriveMechanicsFromPathology({ ...base, paO2: 95 });
    const hypoxic = deriveMechanicsFromPathology({ ...base, paO2: 40 });
    expect(hypoxic.pMusAmplitude).toBeGreaterThan(normal.pMusAmplitude);
  });

  it('el coma estructural deprime el drive (GCS bajo -> P0.1 baja, Luo 2020)', () => {
    const alert = deriveMechanicsFromPathology({ ...base, gcs: 15 });
    const coma  = deriveMechanicsFromPathology({ ...base, gcs: 4 });
    expect(coma.pMusAmplitude).toBeLessThan(alert.pMusAmplitude);
  });

  it('la hipertension intracraneal produce hiperventilacion central', () => {
    const normal = deriveMechanicsFromPathology({ ...base, icp: 10 });
    const htic   = deriveMechanicsFromPathology({ ...base, icp: 35 });
    expect(htic.pMusDriveHz).toBeGreaterThan(normal.pMusDriveHz);
  });

  it('acidemia + sedacion: la sedacion deprime pero no borra el estimulo quimico', () => {
    const acidotic = deriveMechanicsFromPathology({ ...base, pH: 7.15 });
    const sedated  = deriveMechanicsFromPathology({ ...base, pH: 7.15, sedationDepth: 0.7 });
    const healthy  = deriveMechanicsFromPathology({ ...base, pH: 7.40, sedationDepth: 0.7 });
    expect(sedated.pMusAmplitude).toBeLessThan(acidotic.pMusAmplitude);
    expect(sedated.pMusAmplitude).toBeGreaterThan(healthy.pMusAmplitude);
  });

  it('EPOC y asma elevan la resistencia — sustrato del atrapamiento aereo', () => {
    const normal = deriveMechanicsFromPathology({ ...base });
    const copd   = deriveMechanicsFromPathology({ ...base, copdActive: true, copdSeverity: 0.8 });
    const asthma = deriveMechanicsFromPathology({ ...base, asthmaActive: true, asthmaSeverity: 0.9 });
    expect(copd.raw).toBeGreaterThan(normal.raw * 2);
    expect(asthma.raw).toBeGreaterThan(normal.raw * 3);
  });
});
