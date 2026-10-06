// src/core/piccoInterpretation.ts
//
// Lectura hemodinamica del PiCCO: convierte el panel de numeros en las tres
// preguntas que se hacen a pie de cama.
//
// MOTIVO: el monitor mostraba diecisiete variables con su rango y nada mas.
// Pero el PiCCO no se lee variable a variable — se lee CRUZANDOLAS. Un indice
// cardiaco bajo no dice nada por si solo: con precarga baja es hipovolemia y
// pide volumen, con precarga alta y agua pulmonar elevada es fallo de bomba y
// el volumen lo empeora. Enseñar a leer esa combinacion es justamente para lo
// que se coloca el cateter.
//
// REFERENCIAS
//   Sakka SG et al., Intensive Care Med 2000;26:180-7 — GEDI como precarga.
//   Michard F, Teboul JL, Chest 2002;121:2000-8 — SVV y respuesta a volumen.
//   Monnet X, Teboul JL, Crit Care 2017;21:147 — limites de validez del SVV.
//   Kushimoto S et al., Crit Care 2012;16:R232 — PVPI distingue el edema por
//     permeabilidad del hidrostatico.
//   Tagami T, Ong MEH, Curr Opin Crit Care 2018;24:209-15 — EVLWI y pronostico.
//   Combes A et al., Intensive Care Med 2004;30:1377-83 — GEF y funcion global.
//   Cecconi M et al., Intensive Care Med 2014;40:1795-815 — consenso sobre
//     monitorizacion del shock (ESICM).

import type { PiCCOSnapshot } from '../store/useMonitoringStore';

// ─── Umbrales ─────────────────────────────────────────────────────────────────
// Los rangos normales coinciden con los que ya pinta el monitor, para que la
// interpretacion no contradiga al numero que hay al lado.
export const PICCO_RANGES = {
  ci:    { low: 3.0,  high: 5.0  },   // L/min/m²
  gedi:  { low: 680,  high: 800  },   // mL/m²
  svri:  { low: 1700, high: 2400 },   // dyn·s·cm⁻⁵/m²
  evlwi: { low: 3,    high: 7    },   // mL/kg PBW
  pvpi:  { low: 1,    high: 3    },
  svv:   { low: 0,    high: 12   },   // %
  scvo2: { low: 70,   high: 80   },   // %
  gef:   { low: 25,   high: 35   },   // %
  do2i:  { low: 300,  high: 650  },   // mL/min/m²
} as const;

export type ShockProfile =
  | 'normal'
  | 'hipovolemico'
  | 'cardiogenico'
  | 'distributivo'
  | 'mixto'
  | 'indeterminado';

export type EdemaNature = 'ninguno' | 'hidrostatico' | 'permeabilidad' | 'indeterminado';

export type Severity = 'ok' | 'warn' | 'alert';

export interface PiccoReading {
  profile: ShockProfile;
  /** Titular del perfil, en una linea. */
  profileLabel: string;
  /** Por que se ha clasificado asi: las variables que lo sostienen. */
  profileWhy: string;
  profileSeverity: Severity;

  edema: EdemaNature;
  edemaLabel: string;
  edemaWhy: string;
  edemaSeverity: Severity;

  /** Respuesta esperada a una carga de volumen. */
  fluidResponse: 'probable' | 'improbable' | 'no_valorable';
  fluidLabel: string;
  fluidWhy: string;

  /** Que hacer ahora, en orden de prioridad. Vacio si no hay nada que corregir. */
  actions: string[];
}

/** Condiciones del paciente que determinan si el SVV es interpretable. */
export interface SvvValidity {
  /** Ventilacion mecanica activa. */
  ventilated: boolean;
  /** Volumen corriente entregado, mL/kg de peso predicho. */
  vtPerKg: number;
  /** Esfuerzo inspiratorio del paciente, cmH2O. 0 = pasivo. */
  patientEffort: number;
  /** Ritmo no sinusal (fibrilacion, extrasistolia frecuente). */
  arrhythmia: boolean;
}

/**
 * El SVV predice respuesta a volumen solo bajo condiciones estrictas
 * (Monnet 2017). Fuera de ellas el numero sigue apareciendo en pantalla pero
 * no significa lo que parece, y tratarlo como valido es un error clasico.
 */
export function svvIsValid(v: SvvValidity): { valid: boolean; reason: string } {
  if (!v.ventilated)        return { valid: false, reason: 'requiere ventilación mecánica' };
  if (v.patientEffort > 1)  return { valid: false, reason: 'el paciente tiene esfuerzo espontáneo' };
  if (v.vtPerKg < 8)        return { valid: false, reason: `VT ${v.vtPerKg.toFixed(1)} mL/kg < 8` };
  if (v.arrhythmia)         return { valid: false, reason: 'ritmo no sinusal' };
  return { valid: true, reason: '' };
}

/** Naturaleza del edema pulmonar: es EL aporte diagnostico propio del PiCCO. */
function readEdema(s: PiCCOSnapshot): Pick<PiccoReading, 'edema' | 'edemaLabel' | 'edemaWhy' | 'edemaSeverity'> {
  const { evlwi, pvpi } = s;
  if (evlwi <= PICCO_RANGES.evlwi.high) {
    return {
      edema: 'ninguno',
      edemaLabel: 'Sin edema pulmonar significativo',
      edemaWhy: `ELWI ${evlwi.toFixed(1)} mL/kg dentro de rango`,
      edemaSeverity: 'ok',
    };
  }
  // Con el agua pulmonar alta, el PVPI dice de donde sale: si la barrera esta
  // intacta el agua viene de la presion (hidrostatico) y depletar funciona; si
  // la barrera fuga, depletar no corrige la causa y compromete la perfusion.
  if (pvpi > PICCO_RANGES.pvpi.high) {
    return {
      edema: 'permeabilidad',
      edemaLabel: 'Edema por permeabilidad (lesional)',
      edemaWhy: `ELWI ${evlwi.toFixed(1)} alto con PVPI ${pvpi.toFixed(1)} > 3: la barrera alveolocapilar fuga`,
      edemaSeverity: evlwi > 14 ? 'alert' : 'warn',
    };
  }
  return {
    edema: 'hidrostatico',
    edemaLabel: 'Edema hidrostático (cardiogénico)',
    edemaWhy: `ELWI ${evlwi.toFixed(1)} alto con PVPI ${pvpi.toFixed(1)} normal: barrera íntegra, el agua viene de la presión`,
    edemaSeverity: evlwi > 14 ? 'alert' : 'warn',
  };
}

/**
 * Lectura completa. `validity` describe si el SVV puede creerse; sin ella se
 * asume el peor caso y el SVV se marca como no valorable.
 */
export function interpretPicco(s: PiCCOSnapshot, validity?: SvvValidity): PiccoReading {
  const R = PICCO_RANGES;
  const lowCI    = s.ci   < R.ci.low;
  const highCI   = s.ci   > R.ci.high;
  const lowPre   = s.gedi < R.gedi.low;
  const highPre  = s.gedi > R.gedi.high;
  const lowSVR   = s.svri < R.svri.low;
  const highSVR  = s.svri > R.svri.high;
  const highELWI = s.evlwi > R.evlwi.high;
  const lowGEF   = s.gef  < R.gef.low;

  // ── Respuesta a volumen ────────────────────────────────────────────────
  const val = validity ? svvIsValid(validity) : { valid: false, reason: 'condiciones desconocidas' };
  let fluidResponse: PiccoReading['fluidResponse'] = 'no_valorable';
  let fluidLabel = 'SVV no valorable';
  let fluidWhy   = val.reason;
  if (val.valid) {
    if (s.svv > 13) {
      fluidResponse = 'probable';
      fluidLabel = 'Probable respuesta a volumen';
      fluidWhy = `SVV ${Math.round(s.svv)} % > 13 en condiciones válidas`;
    } else {
      fluidResponse = 'improbable';
      fluidLabel = 'Respuesta a volumen improbable';
      fluidWhy = `SVV ${Math.round(s.svv)} % ≤ 13: más volumen probablemente solo aumente el agua pulmonar`;
    }
  }

  // ── Perfil hemodinamico ────────────────────────────────────────────────
  let profile: ShockProfile = 'indeterminado';
  let profileLabel = 'Perfil no concluyente';
  let profileWhy = 'la combinación de índice cardíaco, precarga y resistencias no encaja en un patrón único';
  let profileSeverity: Severity = 'warn';

  if (!lowCI && !highCI && !lowPre && !highPre && !lowSVR && !highSVR && !highELWI) {
    profile = 'normal';
    profileLabel = 'Hemodinámica sin alteración';
    profileWhy = `CI ${s.ci.toFixed(1)}, GEDI ${Math.round(s.gedi)} y IRVSi ${Math.round(s.svri)} en rango`;
    profileSeverity = 'ok';
  } else if (lowCI && lowPre) {
    profile = 'hipovolemico';
    profileLabel = 'Patrón hipovolémico';
    profileWhy = `CI ${s.ci.toFixed(1)} bajo con GEDI ${Math.round(s.gedi)} < 680: el corazón no eyecta porque no se llena`;
    profileSeverity = 'alert';
  } else if (lowCI && (highPre || highELWI || lowGEF)) {
    profile = 'cardiogenico';
    profileLabel = 'Patrón cardiogénico (fallo de bomba)';
    profileWhy = `CI ${s.ci.toFixed(1)} bajo con precarga ${highPre ? 'alta' : 'conservada'}`
      + (lowGEF ? `, GEF ${Math.round(s.gef)} % baja` : '')
      + (highELWI ? ` y ELWI ${s.evlwi.toFixed(1)} elevada` : '')
      + ': el problema es la contractilidad, no el llenado';
    profileSeverity = 'alert';
  } else if (lowSVR && !lowCI) {
    profile = 'distributivo';
    profileLabel = 'Patrón distributivo (vasoplejia)';
    profileWhy = `IRVSi ${Math.round(s.svri)} < 1700 con CI ${s.ci.toFixed(1)} conservado o alto: el gasto es suficiente, falla el tono vascular`;
    profileSeverity = 'alert';
  } else if (lowCI && lowSVR) {
    profile = 'mixto';
    profileLabel = 'Patrón mixto (vasoplejia con fallo de bomba)';
    profileWhy = `IRVSi ${Math.round(s.svri)} bajo y CI ${s.ci.toFixed(1)} bajo a la vez: sepsis con depresión miocárdica`;
    profileSeverity = 'alert';
  } else if (lowCI) {
    profile = 'indeterminado';
    profileLabel = 'Índice cardíaco bajo, causa no aclarada';
    profileWhy = `CI ${s.ci.toFixed(1)} bajo con GEDI ${Math.round(s.gedi)} y IRVSi ${Math.round(s.svri)} en rango`;
    profileSeverity = 'alert';
  }

  const edema = readEdema(s);

  // ── Que hacer ──────────────────────────────────────────────────────────
  const actions: string[] = [];
  if (profile === 'hipovolemico') {
    actions.push(fluidResponse === 'improbable'
      ? 'Precarga baja pero SVV no sugiere respuesta: reevaluar antes de insistir con volumen'
      : 'Carga de volumen y reevaluar GEDI e índice cardíaco');
  }
  if (profile === 'cardiogenico') {
    actions.push('Soporte inotrópico (dobutamina o levosimendán); evitar más volumen');
    if (highELWI) actions.push('Considerar depleción si la perfusión lo permite');
  }
  if (profile === 'distributivo') {
    actions.push('Vasopresor para restaurar el tono; el gasto ya es suficiente');
  }
  if (profile === 'mixto') {
    actions.push('Vasopresor junto a soporte inotrópico: coexisten vasoplejia y fallo de bomba');
  }
  if (edema.edema === 'permeabilidad') {
    actions.push('Edema lesional: la depleción no corrige la causa — ventilación protectora y control del foco');
  } else if (edema.edema === 'hidrostatico') {
    actions.push('Edema hidrostático: bajar la presión de llenado mejora el agua pulmonar');
  }
  if (s.scvo2 < R.scvo2.low) {
    actions.push(`ScvO₂ ${Math.round(s.scvo2)} % < 70: el transporte de oxígeno no cubre la demanda`);
  }
  if (s.do2i < R.do2i.low) {
    actions.push(`DO2I ${Math.round(s.do2i)} < 300: revisar gasto, hemoglobina y saturación`);
  }

  return {
    profile, profileLabel, profileWhy, profileSeverity,
    ...edema,
    fluidResponse, fluidLabel, fluidWhy,
    actions,
  };
}
