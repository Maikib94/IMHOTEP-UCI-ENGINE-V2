// src/core/VentilatorAsynchrony.ts
//
// Mecanica de asincronias paciente-ventilador.
//
// PRINCIPIO DE DISEÑO: mecanismo antes que azar. Donde el modelo puede
// generar la asincronia a partir de la fisica que ya simula, se deja emerger
// —el esfuerzo inefectivo aparece porque pMus no vence auto-PEEP mas el
// umbral de trigger, no porque un dado lo decida—. Solo los eventos cuyo
// sustrato no esta modelado (oscilacion cardiaca, fuga variable) se sortean,
// y con prevalencias tomadas de la literatura. Asi, bajar el auto-PEEP o
// afinar el trigger hace desaparecer los esfuerzos inefectivos, que es
// exactamente lo que debe aprender quien usa el simulador.
//
// EVIDENCIA
//  - Blanch L et al., Intensive Care Med 2015;41:633-41 (DOI 10.1007/s00134-015-3692-6)
//    8,7 M de respiraciones en 50 pacientes: AI mediana 3,41 % (IQR 1,95-5,77);
//    el tipo mas frecuente es el esfuerzo inefectivo en espiracion, 2,38 %
//    (IQR 1,36-3,61). AI > 10 % se asocia a mayor mortalidad UCI/hospitalaria.
//  - Thille AW et al., Intensive Care Med 2006;32:1515-22 (DOI 10.1007/s00134-006-0301-8)
//    24 % de los pacientes superan AI 10 %. Esfuerzo inefectivo y doble disparo
//    son los dos patrones dominantes. El esfuerzo inefectivo se asocia a
//    trigger poco sensible, presion de soporte alta y VT alto. El doble
//    disparo es mas frecuente en asistida-controlada que en PSV.
//  - Luo XY et al., Ann Intensive Care 2020;10:144 (DOI 10.1186/s13613-020-00763-8)
//    100 neurocriticos: AI mediana 12,4 %. El esfuerzo inefectivo predomina y
//    se asocia a P0.1 baja (drive deprimido). El AI sube significativamente
//    con opioides y sedantes COMBINADOS, y baja en modos por presion.
//  - Molenaar MA et al., Intensive Care Med 2026 (SYNAPsE, DOI 10.1007/s00134-026-08328-2)
//    Consenso Delphi: doble disparo y esfuerzo inefectivo son los mas
//    relevantes; auto-disparo y ciclado tardio apenas se distinguen mirando
//    solo las curvas.
//  - Colombo D et al., Crit Care Med 2011;39:2452-7 (DOI 10.1097/ccm.0b013e318225753c)
//    La deteccion visual por intensivistas es pobre: sensibilidad 22 %
//    respiracion a respiracion. Por eso el simulador NO señala las asincronias
//    salvo que se active el modo docente: detectarlas es parte del ejercicio.

import { rand } from './rng';

export type AsynchronyType =
  | 'ineffective'     // esfuerzo inefectivo durante espiracion (IEE)
  | 'double'          // doble disparo
  | 'autotrigger'     // auto-disparo
  | 'flowStarvation'; // hambre de flujo

export const ASYNC_LABELS_ES: Record<AsynchronyType, string> = {
  ineffective:    'Esfuerzo inefectivo',
  double:         'Doble disparo',
  autotrigger:    'Auto-disparo',
  flowStarvation: 'Hambre de flujo',
};

/** Pista clinica que el modo docente muestra junto al evento. */
export const ASYNC_HINTS_ES: Record<AsynchronyType, string> = {
  ineffective:    'Baje el soporte o el PEEP intrinseco, o haga el trigger mas sensible',
  double:         'Tiempo inspiratorio o VT por debajo de la demanda: alargue Ti o suba VT',
  autotrigger:    'Trigger demasiado sensible o fuga en el circuito',
  flowStarvation: 'Flujo inspiratorio por debajo de la demanda: suba el flujo o pase a presion',
};

export interface AsynchronyInputs {
  /** Amplitud del esfuerzo muscular, cmH2O (0 = pasivo o paralizado). */
  pMusAmplitude: number;
  /** Umbral de disparo efectivo ya convertido a cmH2O equivalentes. */
  triggerThresholdCmH2O: number;
  /** PEEP intrinseca medida en el ciclo previo, cmH2O. */
  autoPeep: number;
  /** Volumen corriente entregado por kg de peso predicho, mL/kg. */
  vtPerKg: number;
  /** Fraccion de fuga del circuito, 0-1. */
  leakFraction: number;
  /** Modo ventilatorio activo. */
  mode: string;
  /** Flujo inspiratorio entregado, L/min (relevante solo en VCV). */
  deliveredFlowLpm: number;
  /** Tiempo inspiratorio programado, s. */
  tInspSet: number;
  /** Duracion del esfuerzo neural del paciente, s. */
  tInspNeural: number;
}

export interface AsynchronyEvent {
  type: AsynchronyType;
  /** simTime en que se detecto, s. */
  atSimS: number;
}

// ─── Constantes calibradas ────────────────────────────────────────────────────

/** Demanda de flujo pico estimada, L/min, por cmH2O de esfuerzo muscular.
 *  Un esfuerzo normal de 3,5 cmH2O pide ~21 L/min, dentro del flujo pico
 *  espontaneo en reposo; uno de 10 cmH2O (drive alto) pide ~60 L/min. */
const FLOW_DEMAND_PER_CMH2O = 6;

/** Margen por el que la demanda debe superar al flujo entregado antes de que
 *  la caida de presion sea visible en la curva. Un desajuste pequeno no
 *  produce hambre de flujo clinicamente reconocible. */
const FLOW_STARVATION_MARGIN = 1.4;

/** Auto-disparo: probabilidad base por respiracion con trigger nominal y sin
 *  fuga. Vignaux 2009 observa auto-disparo en el 13 % de los pacientes; a nivel
 *  de respiracion individual el fenomeno es mucho mas raro. */
const AUTOTRIGGER_BASE_P = 0.004;

/** VT por encima del cual el soporte se considera excesivo (ARDSNet / Thille:
 *  el esfuerzo inefectivo se asocia a VT alto). */
const VT_OVERSUPPORT_MLKG = 8;

/**
 * Evalua que asincronia, si alguna, ocurre en esta respiracion.
 *
 * El orden de evaluacion no es arbitrario: un esfuerzo que no llega a disparar
 * no puede producir despues un doble disparo ni hambre de flujo, asi que el
 * esfuerzo inefectivo se comprueba primero y corta.
 */
export function evaluateAsynchrony(
  input: AsynchronyInputs, simTimeS: number,
): AsynchronyEvent | null {
  const effort = Math.max(0, input.pMusAmplitude);

  // Un paciente pasivo (sedacion profunda, NMBA) no puede desincronizarse:
  // sin esfuerzo no hay conflicto con la maquina. Es el extremo sedado de la
  // U invertida que describe Luo 2020 — el AI cae a cero, no sube.
  if (effort < 0.2) {
    return maybeAutotrigger(input, simTimeS);
  }

  // ── 1. Esfuerzo inefectivo (mecanistico) ────────────────────────────────
  // El paciente debe vencer la PEEP intrinseca ANTES de generar en la via
  // aerea el cambio que el ventilador reconoce como disparo. Es el mecanismo
  // clasico del atrapamiento aereo en EPOC y asma.
  //
  // El sobre-soporte eleva el umbral efectivo: con VT alto el paciente llega
  // al siguiente esfuerzo con menos retroceso elastico disponible
  // (Thille 2006 — VT alto y PS alto predicen esfuerzo inefectivo).
  const oversupport = Math.max(0, input.vtPerKg - VT_OVERSUPPORT_MLKG) * 0.25;
  const effectiveThreshold = input.autoPeep + input.triggerThresholdCmH2O + oversupport;
  if (effort < effectiveThreshold) {
    return { type: 'ineffective', atSimS: simTimeS };
  }

  // ── 2. Hambre de flujo (mecanistico, solo en flujo fijo) ────────────────
  // En VCV el flujo lo fija el operador. Si la demanda del paciente lo supera,
  // la presion en via aerea cae por debajo del objetivo y aparece la muesca
  // caracteristica en la curva de presion.
  if (input.mode === 'VCV') {
    const demandLpm = effort * FLOW_DEMAND_PER_CMH2O;
    if (demandLpm > input.deliveredFlowLpm * FLOW_STARVATION_MARGIN) {
      return { type: 'flowStarvation', atSimS: simTimeS };
    }
  }

  // ── 3. Doble disparo (mecanistico) ──────────────────────────────────────
  // El esfuerzo neural sigue activo cuando la maquina ya ciclo a espiracion:
  // el paciente vuelve a disparar de inmediato y encadena dos insuflaciones
  // sin espiracion entre medias. Mas frecuente en asistida-controlada que en
  // PSV (Thille 2006), porque alli el Ti es fijo y no sigue al paciente.
  if (input.tInspNeural > input.tInspSet * 1.25) {
    return { type: 'double', atSimS: simTimeS };
  }

  return maybeAutotrigger(input, simTimeS);
}

/**
 * Auto-disparo: unico tipo sorteado, porque su sustrato —oscilacion cardiaca
 * transmitida al circuito, fuga variable, agua condensada en las tubuladuras—
 * no forma parte del modelo mecanico. La probabilidad sube al afinar el
 * trigger y con la fuga (Carteaux 2012, Vignaux 2009).
 */
function maybeAutotrigger(input: AsynchronyInputs, simTimeS: number): AsynchronyEvent | null {
  // Un trigger por debajo de 1 cmH2O equivalente se vuelve susceptible; por
  // encima de 2 el ruido del circuito ya no lo alcanza.
  const sensitivity = Math.max(0, 2 - input.triggerThresholdCmH2O) / 2;
  const p = AUTOTRIGGER_BASE_P * (1 + 4 * sensitivity) * (1 + 6 * input.leakFraction);
  return rand('ventAsync') < p ? { type: 'autotrigger', atSimS: simTimeS } : null;
}

/**
 * Indice de asincronia: eventos sobre el total de respiraciones mas los
 * esfuerzos que no llegaron a producir una, que es como lo define la
 * literatura (Thille 2006). Se devuelve en porcentaje.
 */
export function asynchronyIndex(events: number, breaths: number): number {
  const denom = events + Math.max(0, breaths);
  return denom > 0 ? (events / denom) * 100 : 0;
}

/** Umbral de AI severo — asociado a peor desenlace en Blanch 2015 y Thille 2006. */
export const AI_SEVERE_THRESHOLD = 10;
