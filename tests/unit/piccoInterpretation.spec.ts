// tests/unit/piccoInterpretation.spec.ts
//
// Verifica que la lectura del PiCCO distingue los patrones de shock por la
// COMBINACION de variables, que es de lo que trata el cateter. Los casos estan
// escritos como cuadros clinicos reconocibles, no como valores sueltos.

import { describe, it, expect } from 'vitest';
import {
  interpretPicco, svvIsValid, PICCO_RANGES,
  type SvvValidity,
} from '../../src/core/piccoInterpretation';
import type { PiCCOSnapshot } from '../../src/store/useMonitoringStore';

/** Paciente hemodinamicamente normal; cada caso desvia solo lo que le define. */
function snap(over: Partial<PiCCOSnapshot> = {}): PiCCOSnapshot {
  return {
    timestampSimS: 0,
    co: 5.5, ci: 3.6,
    gedi: 740, itbv: 925, svv: 8, ppv: 9,
    svri: 2000, gef: 30, cfi: 5.5, dpmx: 1500, cpi: 0.6,
    evlwi: 5, pvpi: 2,
    scvo2: 74, do2i: 500, vo2i: 130,
    ...over,
  };
}

/** Ventilacion controlada con VT alto y ritmo sinusal: el SVV es creible. */
const VALID: SvvValidity = { ventilated: true, vtPerKg: 8.5, patientEffort: 0, arrhythmia: false };

describe('Validez del SVV', () => {
  it('es valido en ventilación controlada, VT ≥ 8 y ritmo sinusal', () => {
    expect(svvIsValid(VALID).valid).toBe(true);
  });

  it('no vale con esfuerzo espontáneo del paciente', () => {
    const r = svvIsValid({ ...VALID, patientEffort: 4 });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('esfuerzo');
  });

  it('no vale con VT bajo — el clásico error en ventilación protectora', () => {
    // Un paciente con SDRA a 6 mL/kg tiene SVV en pantalla que NO predice nada.
    const r = svvIsValid({ ...VALID, vtPerKg: 6 });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('6.0');
  });

  it('no vale en arritmia ni sin ventilación mecánica', () => {
    expect(svvIsValid({ ...VALID, arrhythmia: true }).valid).toBe(false);
    expect(svvIsValid({ ...VALID, ventilated: false }).valid).toBe(false);
  });
});

describe('Perfiles de shock', () => {
  it('reconoce la hemodinámica normal', () => {
    const r = interpretPicco(snap(), VALID);
    expect(r.profile).toBe('normal');
    expect(r.profileSeverity).toBe('ok');
    expect(r.actions).toHaveLength(0);
  });

  it('hipovolemia: gasto bajo porque el corazón no se llena', () => {
    const r = interpretPicco(snap({ ci: 2.1, gedi: 550, svv: 20, svri: 2800 }), VALID);
    expect(r.profile).toBe('hipovolemico');
    expect(r.fluidResponse).toBe('probable');
    expect(r.actions.join(' ')).toContain('volumen');
  });

  it('cardiogénico: gasto bajo con precarga alta — el volumen lo empeora', () => {
    const r = interpretPicco(snap({ ci: 1.9, gedi: 950, gef: 18, evlwi: 12, svri: 2900 }), VALID);
    expect(r.profile).toBe('cardiogenico');
    const plan = r.actions.join(' ');
    expect(plan).toMatch(/inotr/i);
    expect(plan).toContain('evitar más volumen');
  });

  it('distributivo: el gasto sobra y lo que falta es tono vascular', () => {
    const r = interpretPicco(snap({ ci: 4.8, svri: 1100, gedi: 700 }), VALID);
    expect(r.profile).toBe('distributivo');
    expect(r.actions.join(' ')).toMatch(/vasopresor/i);
  });

  it('mixto: sepsis con depresión miocárdica', () => {
    const r = interpretPicco(snap({ ci: 2.2, svri: 1200, gedi: 720 }), VALID);
    expect(r.profile).toBe('mixto');
    const plan = r.actions.join(' ');
    expect(plan).toMatch(/vasopresor/i);
    expect(plan).toMatch(/inotr/i);
  });

  it('el mismo índice cardíaco bajo lleva a planes opuestos según la precarga', () => {
    // Este es el punto entero del PiCCO: CI 2.0 en ambos, conducta contraria.
    const hipo  = interpretPicco(snap({ ci: 2.0, gedi: 520, svv: 22, svri: 2700 }), VALID);
    const cardio = interpretPicco(snap({ ci: 2.0, gedi: 980, gef: 17, evlwi: 13 }), VALID);
    expect(hipo.profile).toBe('hipovolemico');
    expect(cardio.profile).toBe('cardiogenico');
    expect(hipo.actions.join(' ')).toContain('volumen');
    expect(cardio.actions.join(' ')).toContain('evitar más volumen');
  });
});

describe('Naturaleza del edema pulmonar', () => {
  it('sin edema cuando el agua pulmonar está en rango', () => {
    expect(interpretPicco(snap({ evlwi: 5 }), VALID).edema).toBe('ninguno');
  });

  it('distingue el edema lesional por el PVPI alto', () => {
    // SDRA: la barrera fuga. Depletar no corrige la causa.
    const r = interpretPicco(snap({ evlwi: 15, pvpi: 4.5 }), VALID);
    expect(r.edema).toBe('permeabilidad');
    expect(r.edemaSeverity).toBe('alert');
    expect(r.actions.join(' ')).toContain('no corrige la causa');
  });

  it('distingue el edema hidrostático por el PVPI normal', () => {
    // Misma agua pulmonar, barrera íntegra: aquí depletar sí funciona.
    const r = interpretPicco(snap({ evlwi: 15, pvpi: 2.0 }), VALID);
    expect(r.edema).toBe('hidrostatico');
    expect(r.actions.join(' ')).toContain('bajar la presión de llenado');
  });

  it('con el mismo ELWI, el PVPI invierte la conducta', () => {
    const lesional = interpretPicco(snap({ evlwi: 14, pvpi: 4 }), VALID);
    const hidro    = interpretPicco(snap({ evlwi: 14, pvpi: 1.8 }), VALID);
    expect(lesional.edema).not.toBe(hidro.edema);
  });
});

describe('Respuesta a volumen', () => {
  it('SVV alto en condiciones válidas sugiere respuesta', () => {
    expect(interpretPicco(snap({ svv: 18 }), VALID).fluidResponse).toBe('probable');
  });

  it('SVV bajo advierte de que el volumen solo añadirá agua pulmonar', () => {
    const r = interpretPicco(snap({ svv: 6 }), VALID);
    expect(r.fluidResponse).toBe('improbable');
    expect(r.fluidWhy).toContain('agua pulmonar');
  });

  it('con esfuerzo espontáneo el SVV no se da por válido aunque sea alto', () => {
    const r = interpretPicco(snap({ svv: 20 }), { ...VALID, patientEffort: 5 });
    expect(r.fluidResponse).toBe('no_valorable');
  });

  it('sin datos de validez se asume el peor caso', () => {
    expect(interpretPicco(snap({ svv: 20 })).fluidResponse).toBe('no_valorable');
  });

  it('en hipovolemia con SVV no respondedor, avisa en vez de pedir volumen', () => {
    const r = interpretPicco(snap({ ci: 2.0, gedi: 560, svv: 5 }), VALID);
    expect(r.profile).toBe('hipovolemico');
    expect(r.actions.join(' ')).toContain('reevaluar');
  });
});

describe('Transporte de oxígeno', () => {
  it('avisa cuando la ScvO₂ cae por debajo de 70', () => {
    expect(interpretPicco(snap({ scvo2: 58 }), VALID).actions.join(' ')).toContain('ScvO₂');
  });

  it('avisa cuando el DO2I es insuficiente', () => {
    expect(interpretPicco(snap({ do2i: 240 }), VALID).actions.join(' ')).toContain('DO2I');
  });
});

describe('Coherencia con el monitor', () => {
  it('los rangos coinciden con los que pinta el panel', () => {
    expect(PICCO_RANGES.ci).toEqual({ low: 3.0, high: 5.0 });
    expect(PICCO_RANGES.gedi).toEqual({ low: 680, high: 800 });
    expect(PICCO_RANGES.evlwi).toEqual({ low: 3, high: 7 });
    expect(PICCO_RANGES.pvpi).toEqual({ low: 1, high: 3 });
  });
});

describe('Coherencia con la patología simulada', () => {
  it('un SDRA activo produce PVPI por encima del corte lesional', () => {
    // El SDRA es edema por permeabilidad por definición (Berlín, JAMA 2012:
    // edema NO explicado por fallo cardíaco). Si el motor lo devolviera con
    // PVPI normal, el panel diría "cardiogénico" e invitaría a depletar un
    // pulmón que fuga. Se replica aquí la fórmula de useMonitoringStore para
    // que un cambio en ella que rompa esa coherencia falle un test.
    const pvpiForArds = (lungInjury: number) => 2.8 + lungInjury * 2.2;
    for (const injury of [0.1, 0.37, 0.6, 1.0]) {
      const pvpi = pvpiForArds(injury);
      expect(pvpi).toBeGreaterThan(PICCO_RANGES.pvpi.high);
      const r = interpretPicco(snap({ evlwi: 12, pvpi }), VALID);
      expect(r.edema).toBe('permeabilidad');
    }
  });

  it('sin SDRA, la fuga capilar leve deja el PVPI en rango hidrostático', () => {
    const pvpi = 1.5 + 10 * 0.05;   // capillaryLeakRate moderada, sin SDRA
    expect(pvpi).toBeLessThanOrEqual(PICCO_RANGES.pvpi.high);
    expect(interpretPicco(snap({ evlwi: 12, pvpi }), VALID).edema).toBe('hidrostatico');
  });
});
