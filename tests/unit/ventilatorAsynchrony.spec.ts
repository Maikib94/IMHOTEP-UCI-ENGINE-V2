// tests/unit/ventilatorAsynchrony.spec.ts
//
// Verifica que la mecanica de asincronias reproduce los MECANISMOS descritos
// en la literatura, no unas cifras concretas: lo que debe sostenerse es que
// subir el auto-PEEP produzca esfuerzos inefectivos, que afinar el trigger los
// elimine, y que un paciente pasivo no se desincronice.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateAsynchrony, asynchronyIndex, AI_SEVERE_THRESHOLD,
  type AsynchronyInputs,
} from '../../src/core/VentilatorAsynchrony';
import { seedAll } from '../../src/core/rng';

/** Paciente con drive conservado, ventilado en PSV sin atrapamiento. */
function baseline(): AsynchronyInputs {
  return {
    pMusAmplitude:         3.5,   // esfuerzo normal
    triggerThresholdCmH2O: 1.0,   // trigger nominal
    autoPeep:              0,
    vtPerKg:               6.0,   // ventilacion protectora
    leakFraction:          0,
    mode:                  'PSV',
    deliveredFlowLpm:      60,
    tInspSet:              1.0,
    tInspNeural:           1.0,
  };
}

beforeEach(() => seedAll(12345));

describe('Asincronia paciente-ventilador', () => {
  it('un paciente sincronizado en condiciones nominales no genera asincronia', () => {
    let events = 0;
    for (let i = 0; i < 500; i++) {
      if (evaluateAsynchrony(baseline(), i)) events++;
    }
    // Solo puede aparecer auto-disparo esporadico (unico tipo sorteado).
    expect(asynchronyIndex(events, 500 - events)).toBeLessThan(5);
  });

  it('el auto-PEEP produce esfuerzo inefectivo — mecanismo de EPOC/asma', () => {
    const trapped = { ...baseline(), autoPeep: 8 };  // esfuerzo 3.5 < 8 + 1
    const ev = evaluateAsynchrony(trapped, 0);
    expect(ev?.type).toBe('ineffective');
  });

  it('subir el esfuerzo por encima del auto-PEEP recupera el disparo', () => {
    const strong = { ...baseline(), autoPeep: 8, pMusAmplitude: 12 };
    const ev = evaluateAsynchrony(strong, 0);
    expect(ev?.type).not.toBe('ineffective');
  });

  it('un trigger poco sensible basta para provocar esfuerzo inefectivo (Thille 2006)', () => {
    const dull = { ...baseline(), triggerThresholdCmH2O: 6 };
    expect(evaluateAsynchrony(dull, 0)?.type).toBe('ineffective');
    // Afinarlo lo corrige sin tocar nada mas.
    const sharp = { ...dull, triggerThresholdCmH2O: 1 };
    expect(evaluateAsynchrony(sharp, 0)?.type).not.toBe('ineffective');
  });

  it('el sobre-soporte (VT alto) favorece el esfuerzo inefectivo (Thille 2006)', () => {
    // VT 14 mL/kg eleva el umbral efectivo en (14-8)*0.25 = 1.5 cmH2O.
    const over = { ...baseline(), pMusAmplitude: 2.0, vtPerKg: 14 };
    expect(evaluateAsynchrony(over, 0)?.type).toBe('ineffective');
    const protective = { ...over, vtPerKg: 6 };
    expect(evaluateAsynchrony(protective, 0)?.type).not.toBe('ineffective');
  });

  it('un paciente pasivo no se desincroniza — extremo sedado de la U de Luo 2020', () => {
    const paralysed = { ...baseline(), pMusAmplitude: 0, autoPeep: 12 };
    let events = 0;
    for (let i = 0; i < 300; i++) if (evaluateAsynchrony(paralysed, i)) events++;
    // Sin esfuerzo no hay conflicto: solo queda el auto-disparo esporadico.
    expect(events).toBeLessThan(15);
  });

  it('el esfuerzo neural mas largo que el Ti programado produce doble disparo', () => {
    const short = { ...baseline(), tInspSet: 0.6, tInspNeural: 1.4 };
    expect(evaluateAsynchrony(short, 0)?.type).toBe('double');
    // Alargar el Ti para acompasarlo al paciente lo resuelve.
    const matched = { ...short, tInspSet: 1.4 };
    expect(evaluateAsynchrony(matched, 0)?.type).not.toBe('double');
  });

  it('en VCV la demanda por encima del flujo fijo produce hambre de flujo', () => {
    const starved = { ...baseline(), mode: 'VCV', pMusAmplitude: 9, deliveredFlowLpm: 30 };
    expect(evaluateAsynchrony(starved, 0)?.type).toBe('flowStarvation');
    // Subir el flujo a la demanda (9 x 10 = 90 L/min) lo corrige.
    const supplied = { ...starved, deliveredFlowLpm: 90 };
    expect(evaluateAsynchrony(supplied, 0)?.type).not.toBe('flowStarvation');
  });

  it('en modos por presion no aparece hambre de flujo (Luo 2020: menos asincronia)', () => {
    const psv = { ...baseline(), mode: 'PSV', pMusAmplitude: 9, deliveredFlowLpm: 30 };
    expect(evaluateAsynchrony(psv, 0)?.type).not.toBe('flowStarvation');
  });

  it('la fuga aumenta el auto-disparo (Vignaux 2009)', () => {
    const sealed = { ...baseline(), pMusAmplitude: 0, leakFraction: 0 };
    const leaky  = { ...baseline(), pMusAmplitude: 0, leakFraction: 0.5 };
    const count = (inp: AsynchronyInputs) => {
      seedAll(999);
      let n = 0;
      for (let i = 0; i < 3000; i++) if (evaluateAsynchrony(inp, i)) n++;
      return n;
    };
    expect(count(leaky)).toBeGreaterThan(count(sealed));
  });

  it('el indice de asincronia es reproducible con la misma semilla', () => {
    const run = () => {
      seedAll(4242);
      let n = 0;
      for (let i = 0; i < 400; i++) if (evaluateAsynchrony(baseline(), i)) n++;
      return n;
    };
    expect(run()).toBe(run());
  });

  it('asynchronyIndex devuelve porcentaje sobre el total de esfuerzos', () => {
    expect(asynchronyIndex(10, 90)).toBeCloseTo(10, 5);
    expect(asynchronyIndex(0, 100)).toBe(0);
    expect(asynchronyIndex(0, 0)).toBe(0);
    expect(AI_SEVERE_THRESHOLD).toBe(10);
  });
});
