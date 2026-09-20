// src/core/VentilatorSM100Engine.ts
//
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  IMHOTEP UCI â€” Motor Mindray SM100 de alta fidelidad
//  Autor: IMHOTEP Core Physics Team
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
//  FÃSICA IMPLEMENTADA (sin placeholders):
//    1. EcuaciÃ³n de movimiento respiratorio (single-compartment lineal)
//       P_aw(t) = (1/Crs)Â·V(t) + RawÂ·VÌ‡(t) + PEEP + P_mus(t)
//       Integrada con Runge-Kutta 2Âº orden a 1000 Hz.
//
//    2. ATRC â€” Rohrer:  Î”P = (K1Â·|VÌ‡| + K2Â·VÌ‡Â²) Â· C_rate
//       Constantes K1/K2 de Flevari et al. Anaesth Intensive Care 2011 (IDs 6.5-9.0).
//
//    3. PRVC â€” controlador discreto con lÃ­mites clÃ­nicos SM100:
//       Î”P â‰¤ 3 cmHâ‚‚O (10 en las 3 primeras respiraciones), P_max â‰¤ P_alarm âˆ’ 5.
//
//    4. AMV/Otis â€” minimizaciÃ³n analÃ­tica del WOB con RC_exp = RawÂ·Crs,
//       devolviendo frecuencia Ã³ptima y V_T Ã³ptimo para la VA demandada.
//
//    5. Triggering flow/pressure con histÃ©resis y ventana refractaria.
//
//    6. Salidas acopladas a hemodinamia:
//         - P_pl(t)  (pleural) â†’ retorno venoso (Guyton)
//         - P_TP(t)  (transpulmonar) â†’ postcarga VD
//         - P_mean    â†’ transmisiÃ³n a CVP
//         - flag ACP (Acute Cor Pulmonale) si Pplat > 27 y SDRA severo/sepsis
//
//  REFERENCIAS (peer-reviewed, indexadas):
//    Vieillard-Baron A. et al. Intensive Care Med 2016;42(5):739-49.   [ARDSÂ·MV]
//    Lanspa M. et al.          Chest 2020;157(1):95-104.               [RVÂ·sepsis]
//    Vallabhajosyula S. et al. Chest 2021;159(6):2357-2369.            [RVÂ·meta]
//    Berger D. et al.          Am J Physiol HCP 2016;311:H794-H806.    [PEEPÂ·VR]
//    Flevari AG et al.         Anaesth Intensive Care 2011;39:410-17.  [RohrerÂ·ETT]
//    Otis AB.                  J Appl Physiol 1950;2:592-607.          [WOB]
//    Geri G. et al.            J Crit Care 2021;64:100-107.            [CRSÂ·renal]
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import {
  evaluateAsynchrony, asynchronyIndex, type AsynchronyType,
} from './VentilatorAsynchrony';

// â”€â”€â”€ TIPOS PÃšBLICOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type VentMode =
  | 'VCV'    // Volume-Controlled Ventilation (AC)
  | 'PCV'    // Pressure-Controlled Ventilation
  | 'PRVC'   // Pressure-Regulated Volume Control (SM100 flagship)
  | 'PSV'    // Pressure Support (espontÃ¡neo)
  | 'AMV';   // Adaptive Minute Ventilation (Otis)

export interface SM100Settings {
  mode: VentMode;
  fio2: number;              // 0.21 â€“ 1.00
  peep: number;              // cmHâ‚‚O (0 â€“ 25)
  vtTarget: number;          // mL (objetivo en PRVC/VCV)
  rrSet: number;             // respiraciones/min
  pInspSet: number;          // cmHâ‚‚O (PCV)
  pSupport: number;          // cmHâ‚‚O (PSV)
  tInspSet: number;          // segundos (tiempo inspiratorio)
  pMaxAlarm: number;         // cmHâ‚‚O (alarma de presiÃ³n alta, usada por PRVC)
  // ATRC
  atrcEnabled: boolean;
  atrcTubeId: 6.5 | 7.0 | 7.5 | 8.0 | 8.5 | 9.0;
  atrcCompensation: number;  // 0.0 â€“ 1.0 (C_rate)
  // Triggering
  triggerType: 'flow' | 'pressure';
  flowTriggerLpm: number;    // 0.5 â€“ 15 L/min
  pressTriggerCmH2O: number; // 0.5 â€“ 20 cmHâ‚‚O
  // AMV
  amvMinuteVentTarget: number; // L/min objetivo (AMV)
  amvWeightKg: number;         // peso corporal predicho (para Vd)
  // PatrÃ³n de flujo VCV (spec 5.B)
  // 'square'      : flujo constante (default) â€” mÃ¡xima entrega, Ppico mÃ¡s alto
  // 'decelerating': empieza 1.6Ã— y decrece a 0.4Ã— (Marini AJRCCM 2020) â€” â†“Ppico
  flowPatternVCV: 'square' | 'decelerating';
}

export interface PatientMechanics {
  crs: number;               // mL/cmHâ‚‚O  (compliance sist. resp.)
  raw: number;               // cmHâ‚‚O/L/s (resistencia vÃ­a aÃ©rea)
  eCw_eTot: number;          // 0.3â€“0.7  (fracciÃ³n pared torÃ¡cica / E_total)
  pMusAmplitude: number;     // cmHâ‚‚O (esfuerzo muscular mÃ¡ximo; 0 = paralizado)
  pMusDriveHz: number;       // frecuencia espontÃ¡nea Hz
  vAnat: number;             // mL (espacio muerto anatÃ³mico ~2.2Â·kg)
}

/** Muestras de las seÃ±ales en tiempo real (buffer circular para UI). */
export interface SM100Waveforms {
  t: Float32Array;     // segundos relativos (rolling window)
  paw: Float32Array;   // presiÃ³n vÃ­a aÃ©rea proximal (cmHâ‚‚O)
  pTrach: Float32Array; // presiÃ³n traqueal (Paw âˆ’ Î”P_ETT) (cmHâ‚‚O)
  flow: Float32Array;  // flujo (L/min)  (+inspiraciÃ³n / âˆ’espiraciÃ³n)
  vol: Float32Array;   // volumen acumulado (mL)
  ppl: Float32Array;   // presiÃ³n pleural estimada (cmHâ‚‚O)
  pTP: Float32Array;   // presiÃ³n transpulmonar (cmHâ‚‚O)
  length: number;      // nÃºmero de muestras vÃ¡lidas
  writeIdx: number;    // Ã­ndice de escritura circular
}

/** MÃ©tricas "por respiraciÃ³n" calculadas cada ciclo (para monitor digital). */
export interface SM100BreathMetrics {
  breathId: number;
  tCycle: number;            // duraciÃ³n ciclo (s)
  tInsp: number;
  tExp: number;
  ieRatio: number;           // I:E
  vtInsp: number;            // mL
  vtExp: number;             // mL
  minVol: number;            // L/min
  pPeak: number;             // cmHâ‚‚O
  pPlat: number;             // cmHâ‚‚O
  pMean: number;             // cmHâ‚‚O
  autoPeep: number;          // cmHâ‚‚O
  drivingPressure: number;   // cmHâ‚‚O (Pplat âˆ’ PEEP)
  mechPowerJmin: number;     // J/min (ecuaciÃ³n Gattinoni 2016)
  cStatMeasured: number;     // mL/cmHâ‚‚O
  rAwMeasured: number;       // cmHâ‚‚O/L/s
  // ATRC
  pTrachPeak: number;        // Ppeak âˆ’ Î”P_ETT
  pTrachPlat: number;        // Pplat âˆ’ Î”P_ETT
  // PRVC
  pInspTarget: number;       // cmHâ‚‚O (objetivo entregado en la respiraciÃ³n)
  prvcDelta: number;         // cmHâ‚‚O (ajuste aplicado)
  // Hemo
  pplMean: number;           // cmHâ‚‚O (promedio ciclo)
  pplSwing: number;          // cmHâ‚‚O (Î” ipsoâ€“esp)
  pTPPeak: number;           // cmHâ‚‚O
  acpFlag: boolean;          // Acute Cor Pulmonale pendiente de confirmaciÃ³n
  // Asincronia paciente-ventilador (ver VentilatorAsynchrony.ts)
  asynchrony: AsynchronyType | null;  // tipo detectado en ESTE ciclo, si hubo
  asynchronyIndex: number;            // AI acumulado, %
  asyncCounts: Record<AsynchronyType, number>;  // conteo por tipo desde el reset
}

// â”€â”€â”€ CONSTANTES ROHRER (Flevari 2011 adult ETTs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//   K1: componente lineal laminar (cmHâ‚‚O / (L/s))   â€” tÃ­picamente baja
//   K2: componente cuadrÃ¡tica turbulenta (cmHâ‚‚O / (L/s)Â²) â€” dominante
const ROHRER_K: Record<number, { k1: number; k2: number }> = {
  6.5: { k1: 5.5, k2: 12.80 },
  7.0: { k1: 4.7, k2: 9.17  },
  7.5: { k1: 3.9, k2: 6.01  },
  8.0: { k1: 3.2, k2: 4.65  },
  8.5: { k1: 2.7, k2: 3.05  },
  9.0: { k1: 2.3, k2: 2.42  },
};

// â”€â”€â”€ PARÃMETROS NUMÃ‰RICOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PHYS_HZ = 1000;                    // Hz (integraciÃ³n ODE)
const WAVE_HZ = 100;                     // Hz (downsample para UI)
// ─── REGLA DE TIEMPO (FASE 5 fix) ────────────────────────────────────────────
//  wf.t[] almacena SIEMPRE simTime. A x60x buffer = 50 sim-segundos.
const WAVE_BUF_SECONDS = 50;
const WAVE_BUF = WAVE_HZ * WAVE_BUF_SECONDS;  // 5000 muestras

// PRVC
const PRVC_DELTA_NORMAL = 3;             // cmHâ‚‚O/ciclo
const PRVC_DELTA_TEST   = 10;            // primeras 3 respiraciones
const PRVC_TEST_BREATHS = 3;
const PRVC_MARGIN_TO_ALARM = 5;          // P_max = P_alarm âˆ’ 5
const PRVC_GAIN = 0.7;                   // acoplamiento proporcional (Î”P = GAIN Â· Î”VÌ‡Â·Ï„)

// Otis / AMV
const OTIS_MV_FLOOR = 3.0;               // L/min (safeguard)

// Hemodinamia
const ACP_PPLAT_THR = 27;                // cmHâ‚‚O â€” Acute Cor Pulmonale threshold (Vieillard-Baron 2016)

// â”€â”€â”€ UTILIDADES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

const LPS_to_Lmin = (lps: number) => lps * 60;
const Lmin_to_LPS = (lpm: number) => lpm / 60;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  MOTOR PRINCIPAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export class VentilatorSM100Engine {
  // â”€â”€ singleton â”€â”€
  private static inst: VentilatorSM100Engine | null = null;
  public static getInstance(): VentilatorSM100Engine {
    if (!VentilatorSM100Engine.inst) VentilatorSM100Engine.inst = new VentilatorSM100Engine();
    return VentilatorSM100Engine.inst;
  }

  // â”€â”€ estado integrado (fÃ­sico, 1 kHz) â”€â”€
  private simTime   = 0;          // s (tiempo fÃ­sico simulado â€” avanza con dtÃ—speedMult)
  private phaseT    = 0;          // s (tiempo dentro del ciclo actual)
  private phase: 'insp' | 'exp' = 'insp';
  private vol       = 0;          // mL (volumen pulmonar INSPIRADO en el ciclo)
  private flow      = 0;          // L/s (flujo instantÃ¡neo)
  private paw       = 0;          // cmHâ‚‚O (Paw instantÃ¡nea)
  private ppl       = 0;          // cmHâ‚‚O (pleural instantÃ¡nea)
  private pTP       = 0;          // cmHâ‚‚O (transpulmonar instantÃ¡nea)

  // PRVC interno
  private pInspTarget = 15;       // cmHâ‚‚O (presiÃ³n objetivo actual del PRVC)
  private prvcBreathCount = 0;
  private lastPrvcDelta = 0;

  // MÃ©tricas del ciclo actual
  private peakPaw = 0;
  private peakPTrach = 0;
  private sumPawDt = 0;
  private sumPplDt = 0;
  private sumAbsFlowDt = 0;
  private pplMin = 0;
  private pplMax = 0;
  private vtInspired = 0;
  private vtExpired = 0;
  private pPlatMeasured = 0;
  // Asincronia — ver VentilatorAsynchrony.ts
  private lastAutoPeep = 0;          // realimenta el umbral de disparo
  private prevEffort = 0;            // esfuerzo del tick previo (deteccion de flanco)
  private asyncBreaths = 0;          // respiraciones sin asincronia
  private asyncEvents = 0;
  private asyncCounts: Record<AsynchronyType, number> =
    { ineffective: 0, double: 0, autotrigger: 0, flowStarvation: 0 };
  private pendingDoubleTrigger = false;
  private cycleStart = 0;

  // Historia (Ãºltima respiraciÃ³n completa)
  private lastMetrics: SM100BreathMetrics = {
    breathId: 0, tCycle: 0, tInsp: 0, tExp: 0, ieRatio: 0,
    vtInsp: 0, vtExp: 0, minVol: 0, pPeak: 0, pPlat: 0, pMean: 0,
    autoPeep: 0, drivingPressure: 0, mechPowerJmin: 0,
    cStatMeasured: 0, rAwMeasured: 0,
    asynchrony: null, asynchronyIndex: 0,
    asyncCounts: { ineffective: 0, double: 0, autotrigger: 0, flowStarvation: 0 },
    pTrachPeak: 0, pTrachPlat: 0,
    pInspTarget: 0, prvcDelta: 0,
    pplMean: 0, pplSwing: 0, pTPPeak: 0, acpFlag: false,
  };

  // Buffer de waveforms (Float32 circular)
  private wf: SM100Waveforms = {
    t:      new Float32Array(WAVE_BUF),
    paw:    new Float32Array(WAVE_BUF),
    pTrach: new Float32Array(WAVE_BUF),
    flow:   new Float32Array(WAVE_BUF),
    vol:    new Float32Array(WAVE_BUF),
    ppl:    new Float32Array(WAVE_BUF),
    pTP:    new Float32Array(WAVE_BUF),
    length: 0,
    writeIdx: 0,
  };
  private waveAccumulator = 0;

  // Trigger
  private triggerArmed = true;
  private refractoryS = 0;

  // AMV cache
  private amvResult = { fOpt: 14, vtOpt: 500 };

  private constructor() {}

  // â”€â”€â”€ API PÃšBLICA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Getters */
  public getWaveforms(): SM100Waveforms { return this.wf; }
  public getLastBreath(): SM100BreathMetrics { return this.lastMetrics; }
  /** Tiempo pared acumulado (s). Avanza a 1 s/s real independiente de speedMultiplier. */
  public getWaveCursorTime(): number { return this.simTime; }

  /**
   * Devuelve muestras del buffer circular con t âˆˆ [t0, t1] (tiempo pared, waveTime).
   * Recorre el buffer hacia atrÃ¡s desde writeIdx; Ãºtil para el cursor-based renderer.
   * Complejidad O(WAVE_BUF) en el peor caso â€” el buffer es pequeÃ±o (600 muestras).
   */
  public getSamplesInRange(t0: number, t1: number): Array<{
    t: number; paw: number; flow: number; vol: number;
  }> {
    const result: Array<{ t: number; paw: number; flow: number; vol: number }> = [];
    const len = this.wf.length;
    if (len === 0) return result;
    const bufLen = this.wf.t.length;
    const wi     = this.wf.writeIdx;
    for (let k = 0; k < len; k++) {
      const idx = (wi - 1 - k + bufLen) % bufLen;
      const tSample = this.wf.t[idx];
      if (tSample < t0) break;   // older than window start â€” stop early
      if (tSample <= t1) {
        result.push({
          t:    tSample,
          paw:  this.wf.paw[idx],
          flow: this.wf.flow[idx],
          vol:  this.wf.vol[idx],
        });
      }
    }
    result.reverse();   // chronological order
    return result;
  }

  public getInstantState() {
    return {
      paw: this.paw, flow: this.flow, vol: this.vol,
      ppl: this.ppl, pTP: this.pTP, phase: this.phase,
      simTime: this.simTime, pInspTarget: this.pInspTarget,
    };
  }

  /** Reset completo (usado en cambios de modo, inicio de escenario). */
  public reset(peep: number = 5): void {
    this.simTime = 0; this.phaseT = 0; this.phase = 'insp';
    this.vol = 0; this.flow = 0; this.paw = peep; this.ppl = 0; this.pTP = 0;
    this.pInspTarget = Math.max(10, peep + 10);
    this.prvcBreathCount = 0; this.lastPrvcDelta = 0;
    this.peakPaw = 0; this.peakPTrach = 0; this.sumPawDt = 0; this.sumPplDt = 0;
    this.sumAbsFlowDt = 0; this.pplMin = 0; this.pplMax = 0;
    this.vtInspired = 0; this.vtExpired = 0; this.pPlatMeasured = 0;
    this.cycleStart = 0;
    this.wf.length = 0; this.wf.writeIdx = 0; this.waveAccumulator = 0;
    this.wf.t.fill(0); this.wf.paw.fill(0); this.wf.pTrach.fill(0);
    this.wf.flow.fill(0); this.wf.vol.fill(0); this.wf.ppl.fill(0); this.wf.pTP.fill(0);
    this.triggerArmed = true; this.refractoryS = 0;
    this.lastAutoPeep = 0; this.pendingDoubleTrigger = false; this.prevEffort = 0;
    this.asyncBreaths = 0; this.asyncEvents = 0;
    this.asyncCounts = { ineffective: 0, double: 0, autotrigger: 0, flowStarvation: 0 };
    this.lastMetrics = {
      breathId: 0, tCycle: 0, tInsp: 0, tExp: 0, ieRatio: 0,
      vtInsp: 0, vtExp: 0, minVol: 0, pPeak: 0, pPlat: 0, pMean: 0,
      autoPeep: 0, drivingPressure: 0, mechPowerJmin: 0,
      cStatMeasured: 0, rAwMeasured: 0,
    asynchrony: null, asynchronyIndex: 0,
    asyncCounts: { ineffective: 0, double: 0, autotrigger: 0, flowStarvation: 0 },
      pTrachPeak: 0, pTrachPlat: 0,
      pInspTarget: 0, prvcDelta: 0,
      pplMean: 0, pplSwing: 0, pTPPeak: 0, acpFlag: false,
    };
    this.amvResult = { fOpt: 14, vtOpt: 500 };
  }

  /**
   * Avanza el motor `dtMacro` segundos de tiempo simulado usando integraciÃ³n
   * interna a 1 kHz. Llamado por CronosEngine en cada tick.
   */
  /**
   * @param dtMacro  dt fÃ­sico (ya multiplicado por speedMultiplier) â€” para ODE
   * @param s        settings ventilador
   * @param m        mecÃ¡nica paciente
   * @param dtWall   dt pared (wall-clock) â€” para escritura de waveforms a tasa real
   *                 Si se omite, iguala a dtMacro (speed=1Ã—)
   */
  public update(
    dtMacro: number,
    s: SM100Settings,
    m: PatientMechanics,
  ): void {
    if (dtMacro <= 0 || !isFinite(dtMacro)) return;
    const steps = Math.max(1, Math.round(dtMacro * PHYS_HZ));
    const h     = dtMacro / steps;                              // paso ODE fÃ­sico
    const hWave = dtMacro / steps;
    for (let i = 0; i < steps; i++) this.integrateStep(h, s, m, hWave);
  }

  // â”€â”€â”€ OTIS / AMV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  //  Otis AB, J Appl Physiol 1950 minimiza el trabajo respiratorio analÃ­tico.
  //  Para MV objetivo (V_E) y espacio muerto Vd, la frecuencia Ã³ptima es:
  //
  //      f_opt = (âˆš(1 + 4Â·Ï€Â²Â·RC_expÂ·(V_E âˆ’ fÂ·Vd)) âˆ’ 1) / (2Â·Ï€Â²Â·RC_expÂ·Vd)
  //
  //  Algoritmo de Hamilton/SM100 simplifica:
  //      1. Calcular RC_exp = RawÂ·Crs (ms â†’ s)
  //      2. Resolver la cÃºbica iterativamente (Newton) para f que minimiza
  //         el trabajo inspiratorio-espiratorio combinado.
  //      3. V_T = V_E / f   (acotado 3â€“8 mL/kg para protecciÃ³n pulmonar).
  //
  //  ImplementaciÃ³n: bÃºsqueda de mÃ­nimo en W(f) con pasos de 0.5 bpm.
  //
  public computeOtisAMV(
    mvTargetLmin: number,
    weightKg: number,
    m: PatientMechanics,
  ): { fOpt: number; vtOpt: number; wobMin: number } {
    const vE = Math.max(OTIS_MV_FLOOR, mvTargetLmin);    // L/min
    const vD = (m.vAnat > 0 ? m.vAnat : 2.2 * weightKg) / 1000; // L
    const tau = (m.raw * m.crs) / 1000;                  // s  (Crs en mL/cmHâ‚‚O â†’ L/cmHâ‚‚O)

    let fBest = 14, vtBest = 500, wBest = Infinity;
    for (let f = 8; f <= 35; f += 0.5) {
      const va = vE - f * vD;                            // alveolar
      if (va <= 0) continue;
      const vtL = vE / f;                                // L/ciclo
      if (vtL < 0.25 || vtL > 0.9) continue;             // fisiolÃ³gico 250-900 mL
      // WOB Otis (ec. 11): W = Ï€Â²Â·fÂ·(V_E âˆ’ fÂ·Vd)Â² Â·R + (V_EÂ²)/(2Â·fÂ·C)
      const elastic = (vE * vE) / (2 * f * (m.crs / 1000));   // work elÃ¡stico
      const resistive = Math.PI * Math.PI * f * va * va * m.raw;
      const w = elastic + resistive;
      if (w < wBest) { wBest = w; fBest = f; vtBest = vtL * 1000; }
    }
    // ProtecciÃ³n pulmonar ARDSNet + correcciÃ³n Becher 2019:
    //   Otis puro tiende a 8.2 mL/kg (Becher T., Crit Care 2019;23:338). Para no
    //   exagerar, aplicamos dos techos: 8 mL/kg en pulmÃ³n sano, 6 mL/kg si
    //   Crs < 40 (sugestivo de SDRA moderado-severo, Berlin criteria proxy).
    const vtMin = 4 * weightKg;
    const vtMax = m.crs < 40 ? 6 * weightKg : 8 * weightKg;
    vtBest = clamp(vtBest, vtMin, vtMax);
    this.amvResult = { fOpt: fBest, vtOpt: vtBest };
    return { fOpt: fBest, vtOpt: vtBest, wobMin: wBest };
  }

  public getAMVRecommendation() { return this.amvResult; }

  // â”€â”€â”€ INTEGRACIÃ“N ODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  //  EcuaciÃ³n de movimiento en forma resuelta para VÌ‡:
  //    VÌ‡(t) = ( P_aw(t) âˆ’ P_mus(t) âˆ’ PEEP âˆ’ V(t)/Crs ) / Raw
  //
  //  Runge-Kutta 2Âº orden (mÃ©todo del punto medio):
  //    k1 = f(t, V)
  //    k2 = f(t+h/2, V + h/2Â·k1)
  //    V_{n+1} = V_n + hÂ·k2
  //
  //  El driver P_aw lo establece el modo (VCV/PCV/PRVC/PSV) en cada paso.
  //
  private integrateStep(h: number, s: SM100Settings, m: PatientMechanics, hWave = h): void {
    // â”€â”€ 1. Determinar esfuerzo muscular del paciente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pMus = this.computePMus(s, m);

    // â”€â”€ 2. MÃ¡quina de fases: phaseT es mÃ³dulo tCycle, transiciones explÃ­citas â”€
    const tInsp = this.computeTInsp(s);
    const tCycle = 60 / Math.max(4, s.rrSet);

    // Trigger por paciente (adelanta inicio de inspiraciÃ³n)
    const triggered = this.checkTrigger(s, pMus);
    if (triggered && this.phase === 'exp') {
      // Cerramos ciclo anterior y reiniciamos
      this.onBreathStart(s, m);
      this.phaseT = 0;
    }

    const prevPhase = this.phase;
    const isInsp = this.phaseT < tInsp;
    this.phase = isInsp ? 'insp' : 'exp';

    // SÃ³lo publicamos mÃ©tricas al cierre DEL CICLO (phaseT wrap-around),
    // no en la transiciÃ³n inspâ†’exp intermedia. onInspEnd sigue como hook
    // sin side-effects sobre breath metrics.
    if (!isInsp && prevPhase === 'insp') this.onInspEnd();

    const pawTarget = this.computePawTarget(s, isInsp);

    // â”€â”€ 3. RK2 para VÌ‡ y V â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dVdt = (V: number, pawDriver: number) =>
      Lmin_to_LPS(
        LPS_to_Lmin(
          (pawDriver - pMus - s.peep - V / Math.max(0.1, m.crs)) / Math.max(0.1, m.raw)
        )
      ); // L/s

    // Un solo integrador por fase. Antes la espiracion pasaba por DOS: el
    // bloque RK2 de abajo corria igualmente (su condicion incluye isInsp, que
    // en espiracion es falso) y descontaba volumen, y despues el bloque
    // espiratorio volvia a descontar sobre el resultado. El volumen caia al
    // doble de velocidad pero vtExpired solo registraba el segundo descuento,
    // asi que VTe salia ~26 % por debajo de VTi y el panel lo mostraba como
    // una fuga que no existia.
    if (!isInsp) {
      // ── Espiracion pasiva: VÌ‡_exp = âˆ’V/(RawÂ·Crs), decaimiento exponencial ──
      const tau = (m.raw * m.crs) / 1000; // s
      const vExpCurrent = Math.max(0, this.vol);
      this.flow = -vExpCurrent / Math.max(0.05, tau) / 1000; // L/s (negativo)
      const dV = this.flow * h * 1000; // mL negativos
      this.vol = Math.max(0, this.vol + dV);
      this.paw = s.peep; // modelo ideal con vÃ¡lvula PEEP abierta
      this.vtExpired += -dV; // acumula lo exhalado (valor positivo)
    } else if (s.mode === 'VCV') {
      // ── VCV: flujo cuadrado impuesto, Paw emerge de la ecuacion ──────────
      const flowSetLPS = this.vcvFlowLPS(s, this.phaseT);
      this.flow = flowSetLPS;
      this.vol += flowSetLPS * h * 1000;
      this.paw = pMus + s.peep + (this.vol / Math.max(0.1, m.crs))
               + m.raw * flowSetLPS;
      this.vtInspired += Math.max(0, this.flow * h * 1000);
    } else {
      // ── PCV / PRVC / PSV: controlamos Paw, resolvemos VÌ‡ con RK2 ─────────
      const V_mL = this.vol;
      const k1 = dVdt(V_mL, pawTarget);             // L/s a t_n
      const V_mid = V_mL + (h / 2) * k1 * 1000;     // mL intermedio
      const k2 = dVdt(V_mid, pawTarget);            // L/s a t_n+h/2
      this.flow = k2;
      this.vol += h * k2 * 1000;
      this.paw = pawTarget;
      this.vtInspired += Math.max(0, this.flow * h * 1000);
    }

    // â”€â”€ 4. ATRC â€” resta del Î”P_ETT para obtener P_trach â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dPett = this.rohrerDrop(this.flow, s);
    const pTrach = this.paw - Math.sign(this.flow) * dPett;

    // â”€â”€ 5. PresiÃ³n pleural (Ppl) y transpulmonar (TPP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  Ppl = (E_cw / E_tot) Â· (Paw âˆ’ PEEP) + baseline (~ âˆ’5 en respiraciÃ³n tranquila).
    //  TPP = Paw âˆ’ Ppl.
    //  Referencia: Talmor D, NEJM 2008 (Pesoph); Vieillard-Baron ICM 2016.
    const ratio = clamp(m.eCw_eTot, 0.2, 0.8);
    this.ppl = ratio * (this.paw - s.peep) - 5 + 0.3 * pMus;
    this.pTP = this.paw - this.ppl;

    // â”€â”€ 6. MÃ©tricas acumuladas del ciclo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.peakPaw = Math.max(this.peakPaw, this.paw);
    this.peakPTrach = Math.max(this.peakPTrach, pTrach);
    this.sumPawDt += this.paw * h;
    this.sumPplDt += this.ppl * h;
    this.sumAbsFlowDt += Math.abs(this.flow) * h;
    this.pplMin = Math.min(this.pplMin, this.ppl);
    this.pplMax = Math.max(this.pplMax, this.ppl);

    // Pplat = presion elastica al final de la inspiracion, es decir Paw sin su
    // componente resistivo (raw x flow). En un modelo de compartimento unico
    // eso es exactamente lo que mediria una pausa inspiratoria, sin necesidad
    // de forzarla.
    //
    // La version anterior esperaba a que el flujo cayera bajo 0.02 L/s durante
    // la inspiracion. En VCV el flujo es cuadrado: se mantiene constante
    // (~0.67 L/s a 40 L/min) y se corta de golpe cuando isInsp ya es false, asi
    // que nunca entraba en esa ventana. pPlatMeasured quedaba en 0 y el
    // fallback de onBreathStart lo sustituia por Ppico, con lo que
    // Pplat == Ppico, Raw == 0, auto-PEEP == 0 (depende de Raw) y la driving
    // pressure quedaba inflada para los cinco motores que la consumen.
    if (isInsp) {
      this.pPlatMeasured = pMus + s.peep + this.vol / Math.max(0.1, m.crs);
    }

    // â”€â”€ 7. Escritura en buffer de waveforms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Usa hWave (tiempo pared) para mantener tasa 100 Hz real independiente de speedMultiplier.
    // Los timestamps almacenados en wf.t son waveTime (pared), no simTime (fÃ­sico).
    this.waveAccumulator += hWave;
    const waveInterval = 1 / WAVE_HZ;
    if (this.waveAccumulator >= waveInterval) {
      this.waveAccumulator -= waveInterval;
      const i = this.wf.writeIdx;
      this.wf.t[i]      = this.simTime;
      this.wf.paw[i]    = this.paw;
      this.wf.pTrach[i] = pTrach;
      this.wf.flow[i]   = LPS_to_Lmin(this.flow);
      this.wf.vol[i]    = this.vol;
      this.wf.ppl[i]    = this.ppl;
      this.wf.pTP[i]    = this.pTP;
      this.wf.writeIdx = (i + 1) % WAVE_BUF;
      if (this.wf.length < WAVE_BUF) this.wf.length++;
    }

    // â”€â”€ 8. Avanzar tiempo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.simTime  += h;      // tiempo fÃ­sico (usado para ODE y ciclos)
    this.phaseT += h;
    if (this.refractoryS > 0) this.refractoryS = Math.max(0, this.refractoryS - h);

    // â”€â”€ 9. Cierre natural de ciclo: wrap-around phaseT â†’ onBreathStart â”€â”€â”€â”€â”€â”€
    //   Se dispara una vez por ciclo completo. Si un trigger de paciente
    //   adelantÃ³ la inspiraciÃ³n antes, ese cierre se disparÃ³ arriba.
    if (this.phaseT >= tCycle) {
      this.phaseT -= tCycle;
      this.onBreathStart(s, m);
    }
  }

  // â”€â”€â”€ DRIVERS DE PAW POR MODO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //   FunciÃ³n pura: dado el flag isInsp y los settings actuales, devuelve
  //   la presiÃ³n Paw objetivo para ese instante. El flujo temporal y la
  //   mÃ¡quina de estados son responsabilidad de integrateStep().
  private computePawTarget(s: SM100Settings, isInsp: boolean): number {
    if (!isInsp) return s.peep;
    switch (s.mode) {
      case 'PCV':  return s.peep + s.pInspSet;
      case 'PRVC': return s.peep + this.pInspTarget;
      case 'AMV':  return s.peep + this.pInspTarget;   // PRVC internamente
      case 'PSV':  return s.peep + s.pSupport;
      case 'VCV':  // VCV: se maneja con flujo cuadrado en el integrador;
                   // este valor es ignorado por la rama VCV de integrateStep.
      default:     return s.peep;
    }
  }

  private vcvFlowLPS(s: SM100Settings, phaseT: number): number {
    const tInsp = this.computeTInsp(s);
    const targetSquare = (s.vtTarget / 1000) / Math.max(0.1, tInsp); // L/s

    if (s.flowPatternVCV === 'decelerating') {
      // Flujo decelerante: empieza 1.6Ã—, decrece a 0.4Ã— en fracciÃ³n inspiratoria
      // Integral = 1.0 Ã— targetSquare â†’ mismo VT entregado (Marini AJRCCM 2020)
      // â†“Ppico 15-25% porque Paw âˆ VÌ‡Â·Raw â†’ menor pico con flujo inicial creciente-decreciente
      const fracInsp = Math.max(0, Math.min(1, phaseT / Math.max(0.1, tInsp)));
      return targetSquare * (1.6 - 1.2 * fracInsp);
    }
    return targetSquare;
  }

  private computeTInsp(s: SM100Settings): number {
    if (s.tInspSet > 0) return s.tInspSet;
    // I:E 1:2 por defecto
    return (60 / Math.max(4, s.rrSet)) * (1 / 3);
  }

  // â”€â”€â”€ ATRC â€” ROHRER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private rohrerDrop(flowLPS: number, s: SM100Settings): number {
    if (!s.atrcEnabled) return 0;
    const k = ROHRER_K[s.atrcTubeId];
    if (!k) return 0;
    const cRate = clamp(s.atrcCompensation, 0, 1);
    const absF = Math.abs(flowLPS);
    return (k.k1 * absF + k.k2 * absF * absF) * cRate;
  }

  // â”€â”€â”€ ESFUERZO MUSCULAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private computePMus(s: SM100Settings, m: PatientMechanics): number {
    if (m.pMusAmplitude <= 0) return 0;
    // PresiÃ³n negativa sinusoidal durante inspiraciÃ³n espontÃ¡nea
    const omega = 2 * Math.PI * Math.max(0.1, m.pMusDriveHz);
    const phi = this.simTime * omega;
    // Solo fase negativa (inspiraciÃ³n)
    return Math.min(0, -m.pMusAmplitude * Math.max(0, Math.sin(phi)));
  }

  // â”€â”€â”€ TRIGGERING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private checkTrigger(s: SM100Settings, pMus: number): boolean {
    // VCV y PCV son asistida-controlada, no controlada pura: cada esfuerzo que
    // supera el umbral entrega una respiracion completa con los parametros
    // programados. Antes retornaban false sin mas, de modo que el paciente no
    // podia disparar y el doble disparo era imposible justo en los modos donde
    // Thille (Intensive Care Med 2006) lo describe como MAS frecuente que en
    // PSV. Quien impone la ventilacion controlada pura es la ausencia de
    // esfuerzo —sedacion profunda o bloqueo neuromuscular—, que ya anula pMus.
    if (this.phase !== 'exp') return false;
    if (this.refractoryS > 0) return false;

    // Doble disparo armado en el ciclo anterior: el esfuerzo neural seguia
    // activo cuando la maquina ciclo a espiracion, asi que el paciente vuelve
    // a disparar de inmediato y encadena dos insuflaciones.
    if (this.pendingDoubleTrigger) {
      this.pendingDoubleTrigger = false;
      this.refractoryS = 0.25;
      return true;
    }

    // El disparo se evalua sobre el ESFUERZO del paciente (pMus, negativo
    // durante la inspiracion espontanea), no sobre la señal cruda del
    // circuito. La version anterior comparaba `0 - this.flow` contra el
    // umbral, y en espiracion this.flow es negativo por definicion: la resta
    // daba siempre un valor positivo grande, asi que el flujo espiratorio
    // pasivo se interpretaba como un esfuerzo y el ventilador autodisparaba a
    // ~60 rpm incluso con el paciente relajado. Estaba enmascarado porque VCV
    // y PCV retornaban antes de llegar aqui.
    //
    // La PEEP intrinseca se suma al umbral: antes de que el ventilador vea
    // nada, el esfuerzo tiene que neutralizar la presion que el volumen
    // atrapado mantiene en el alveolo. Es el mecanismo del esfuerzo inefectivo
    // en EPOC y asma, y la razon de que bajar el auto-PEEP lo haga desaparecer.
    const effort = Math.max(0, -pMus);   // cmH2O
    const prevEffort = this.prevEffort;
    this.prevEffort = effort;
    if (effort <= 0) return false;

    const thr = this.triggerThresholdCmH2O(s) + this.lastAutoPeep;

    // Disparo por FLANCO de subida, un ciclo por esfuerzo neural. Mirando solo
    // el nivel, un unico esfuerzo disparaba varias veces: la sinusoide de
    // computePMus permanece sobre el umbral bastante mas que la ventana
    // refractaria de 0,25 s, asi que la frecuencia entregada trepaba a ~48 rpm
    // y el tiempo espiratorio ya no bastaba para vaciar (VTe ~0, auto-PEEP 7).
    if (prevEffort < thr && effort >= thr) {
      this.refractoryS = 0.25;
      return true;
    }
    return false;
  }

  /** Umbral de disparo expresado en cmH2O, para poder compararlo con pMus.
   *  El trigger por flujo se convierte usando la conductancia del sistema:
   *  un umbral de 2 L/min sobre una Raw tipica equivale a ~1 cmH2O. */
  private triggerThresholdCmH2O(s: SM100Settings): number {
    if (s.triggerType === 'flow') {
      return clamp(s.flowTriggerLpm, 0.5, 15) * 0.5;
    }
    return clamp(s.pressTriggerCmH2O, 0.5, 20);
  }

  // â”€â”€â”€ EVENTOS DE FIN DE CICLO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private onInspEnd(): void {
    // AquÃ­ podrÃ­amos forzar una pausa inspiratoria para medir Pplat real,
    // pero el modelo single-compartment con flow=0 ya lo aproxima.
  }

  private onBreathStart(s: SM100Settings, m: PatientMechanics): void {
    // Construir mÃ©tricas del ciclo que acaba de terminar
    const tCycle = Math.max(0.01, this.simTime - this.cycleStart);
    const tInsp = this.computeTInsp(s);
    const tExp = Math.max(0.01, tCycle - tInsp);
    const ieRatio = tExp > 0 ? tInsp / tExp : 0;
    const pMean = this.sumPawDt / tCycle;
    const pplMean = this.sumPplDt / tCycle;
    const pplSwing = this.pplMax - this.pplMin;
    const pPlat = this.pPlatMeasured > 0 ? this.pPlatMeasured : this.peakPaw;
    const driveP = Math.max(0, pPlat - s.peep);
    const cStat = driveP > 0.5 ? this.vtInspired / driveP : 0;
    // Rrs aproximado: (Ppeak âˆ’ Pplat) / VÌ‡_peak_insp
    const vDotPeak = this.vtInspired / Math.max(0.1, tInsp) / 1000; // L/s
    const rAw = vDotPeak > 0.05 ? (this.peakPaw - pPlat) / vDotPeak : 0;

    // auto-PEEP a partir del volumen realmente atrapado. this.vol en este
    // punto es el residuo que la espiracion no alcanzo a vaciar antes de que
    // empezara el ciclo siguiente, y la presion que ese volumen genera sobre
    // la compliance es, por definicion, la PEEP intrinseca.
    //
    // Sustituye a la estimacion anterior 2*exp(-tExp/tau), cuyo factor 2 era
    // arbitrario y que ademas dependia de rAw — cero mientras Pplat cayo al
    // fallback de Ppico, con lo que el auto-PEEP era siempre 0.
    const vTrapped = Math.max(0, this.vol);
    const autoPeep = cStat > 0.5 ? vTrapped / cStat : 0;

    // Mechanical Power (Gattinoni 2016):
    // MP(J/min) = 0.098 Â· RR Â· V_T(L) Â· (PEEP + (Pplat âˆ’ PEEP)/2 + RrsÂ·VÌ‡)
    const rr = 60 / tCycle;
    const mp = 0.098 * rr * (this.vtInspired / 1000)
             * (s.peep + driveP / 2 + rAw * vDotPeak);

    // ATRC aplicado a pico/plateau
    const pTrachPeak = this.peakPTrach;
    const pTrachPlat = pPlat - this.rohrerDrop(0.01, s); // ~K1Â·Îµ

    // Flag Acute Cor Pulmonale (Vieillard-Baron 2016: Pplat > 27 + SDRA mod/sev)
    const acpFlag = pPlat > ACP_PPLAT_THR;

    // ── Asincronia paciente-ventilador ──────────────────────────────────────
    // Se evalua una vez por respiracion, con la mecanica del paciente y los
    // ajustes vigentes. El auto-PEEP que entra aqui es el del ciclo que acaba
    // de cerrarse, que es tambien el que el paciente tendra que vencer en el
    // siguiente esfuerzo.
    const pbw = Math.max(30, m.vAnat / 2.2);   // vAnat = 2.2 mL/kg  -> kg
    const asyncEvent = evaluateAsynchrony({
      pMusAmplitude:         m.pMusAmplitude,
      triggerThresholdCmH2O: this.triggerThresholdCmH2O(s),
      autoPeep,
      vtPerKg:               this.vtInspired / pbw,
      leakFraction:          this.vtInspired > 0
        ? clamp(1 - this.vtExpired / this.vtInspired, 0, 1) : 0,
      mode:                  s.mode,
      deliveredFlowLpm:      LPS_to_Lmin(vDotPeak),
      tInspSet:              tInsp,
      // Duracion del esfuerzo neural. El drive sinusoidal de computePMus esta
      // activo medio periodo, pero esa mitad no es el tiempo inspiratorio
      // fisiologico: la relacion I:E neural en respiracion espontanea ronda
      // 1:2, es decir un tercio del ciclo.
      tInspNeural:           (1 / Math.max(0.1, m.pMusDriveHz)) / 3,
    }, this.simTime);

    if (asyncEvent) {
      this.asyncEvents++;
      this.asyncCounts[asyncEvent.type]++;
      // Un doble disparo encadena una segunda insuflacion sin espiracion
      // intermedia; se arma aqui y checkTrigger lo consume en el ciclo siguiente.
      if (asyncEvent.type === 'double') this.pendingDoubleTrigger = true;
    } else {
      this.asyncBreaths++;
    }
    this.lastAutoPeep = autoPeep;

    const prevPrvcTarget = this.pInspTarget;
    let prvcDelta = 0;

    // â”€â”€ PRVC: ajustar presiÃ³n objetivo para prÃ³ximo ciclo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (s.mode === 'PRVC' || s.mode === 'AMV') {
      const vtGoal = (s.mode === 'AMV') ? this.amvResult.vtOpt : s.vtTarget;
      prvcDelta = this.computePRVCAdjustment(this.vtInspired, vtGoal, s);
      const pMax = Math.max(5, s.pMaxAlarm - PRVC_MARGIN_TO_ALARM);
      this.pInspTarget = clamp(this.pInspTarget + prvcDelta, 2, pMax);
      this.prvcBreathCount++;
      this.lastPrvcDelta = prvcDelta;
    }

    this.lastMetrics = {
      breathId: this.lastMetrics.breathId + 1,
      tCycle, tInsp, tExp, ieRatio,
      vtInsp: this.vtInspired, vtExp: this.vtExpired,
      minVol: (this.vtInspired / 1000) * rr,
      pPeak: this.peakPaw, pPlat, pMean,
      autoPeep, drivingPressure: driveP, mechPowerJmin: mp,
      cStatMeasured: cStat, rAwMeasured: rAw,
      asynchrony: asyncEvent ? asyncEvent.type : null,
      asynchronyIndex: asynchronyIndex(this.asyncEvents, this.asyncBreaths),
      asyncCounts: { ...this.asyncCounts },
      pTrachPeak, pTrachPlat,
      pInspTarget: prevPrvcTarget,
      prvcDelta,
      pplMean, pplSwing, pTPPeak: this.peakPaw - this.pplMin,
      acpFlag,
    };

    // Reset contadores para el prÃ³ximo ciclo
    this.cycleStart = this.simTime;
    this.peakPaw = 0; this.peakPTrach = 0;
    this.sumPawDt = 0; this.sumPplDt = 0; this.sumAbsFlowDt = 0;
    this.pplMin = 0; this.pplMax = 0;
    this.vtInspired = 0; this.vtExpired = 0; this.pPlatMeasured = 0;
    this.vol = 0;
    // El estado de asincronia NO se resetea por ciclo: los contadores y el AI
    // son acumulativos, y pendingDoubleTrigger tiene que sobrevivir hasta que
    // checkTrigger lo consuma en el ciclo siguiente.
  }

  // â”€â”€â”€ PRVC â€” CONTROLADOR DISCRETO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  //  Criterio SM100 (Mindray Operator's Manual):
  //    - Ajuste proporcional al error |V_T_real âˆ’ V_T_target|.
  //    - LÃ­mite de paso: Â±3 cmHâ‚‚O, salvo las 3 primeras respiraciones
  //      "test breaths" donde Â±10 cmHâ‚‚O estÃ¡n permitidos.
  //    - Nunca exceder P_alarm âˆ’ 5 cmHâ‚‚O.
  //    - Si V_T real ya estÃ¡ en rango Â±10% del objetivo, no se ajusta.
  //
  private computePRVCAdjustment(
    vtActual: number, vtTarget: number, s: SM100Settings,
  ): number {
    const err = vtTarget - vtActual; // mL positivo si necesitamos mÃ¡s volumen
    const tolerance = 0.10 * vtTarget; // 10% de banda muerta
    if (Math.abs(err) < tolerance) return 0;

    // Ganancia proporcional: aproximamos que 50 mL â‰ˆ 2 cmHâ‚‚O
    // (pendiente de la curva V-P lineal a Crs â‰ˆ 25-60 mL/cmHâ‚‚O)
    let delta = PRVC_GAIN * (err / 25); // cmHâ‚‚O

    const maxStep = (this.prvcBreathCount < PRVC_TEST_BREATHS)
      ? PRVC_DELTA_TEST : PRVC_DELTA_NORMAL;
    delta = clamp(delta, -maxStep, maxStep);
    return delta;
  }
}

// â”€â”€â”€ HELPERS DE PATOLOGÃA (usados externamente para configurar mechanics) â”€â”€â”€â”€

/**
 * Construye el objeto `PatientMechanics` a partir de los modificadores
 * globales de patologÃ­a. Se usa en `RespiratoryEngine` para mantener la
 * coherencia con `PathologyEngine`.
 *
 * Relaciones:
 *   - Crs_base = 50 mL/cmHâ‚‚O (adulto 70 kg sano)
 *   - Raw_base = 5  cmHâ‚‚O/L/s
 *   - SDRA severo: Crs Ã— 0.30, Raw +2   (ARDSnet 2000; Vieillard-Baron 2016)
 *   - Sepsis + SDRA: pared torÃ¡cica mÃ¡s "rÃ­gida" â†’ E_cw/E_tot â†“ de 0.7 a 0.5
 *   - Shock hemorrÃ¡gico: sin cambio intrÃ­nseco pulmonar, pero Ppl cae (baja
 *     presiÃ³n abdominal por hipovolemia). Modelamos con pMusAmplitude â†‘ si
 *     el paciente no estÃ¡ relajado (shock â†’ taquipnea compensatoria).
 */
export function deriveMechanicsFromPathology(params: {
  weightKg?: number;
  ardsSeverity: number;       // 0â€“1
  ardsActive: boolean;
  sepsisSeverity: number;     // 0â€“1
  sepsisActive: boolean;
  hypovolemicFraction: number; // (BV_base âˆ’ BV_curr)/BV_base  (0â€“0.5)
  isSedated: boolean;
  nmbaFraction: number;        // 0â€“1 (parÃ¡lisis NMBA)
  // ── Determinantes del drive respiratorio (ver bloque DRIVE abajo) ────────
  sedationDepth?: number;      // 0â€“1+ profundidad de sedacion (graduada)
  respDepression?: number;     // 0â€“1 depresion respiratoria por opioides
  gcs?: number;                // 3â€“15
  icp?: number;                // mmHg
  pH?: number;
  paCO2?: number;              // mmHg
  paO2?: number;               // mmHg
  copdActive?: boolean;
  copdSeverity?: number;       // 0â€“1
  asthmaActive?: boolean;
  asthmaSeverity?: number;     // 0â€“1
}): PatientMechanics {
  const w = params.weightKg ?? 70;

  // Base
  let crs = 50;
  let raw = 5;
  let eCw = 0.7;
  let pMusAmp = params.isSedated ? 0 : 3.5;   // cmHâ‚‚O esfuerzo (negativo)
  let pMusHz = 14 / 60;                       // 14 rpm basal

  // SDRA: compliance â†“, R ligeramente â†‘ (por edema pequeÃ±as vÃ­as)
  if (params.ardsActive) {
    const sev = clamp(params.ardsSeverity, 0, 1);
    crs *= (1 - sev * 0.70);                  // hasta Ã—0.30
    raw += sev * 5;                           // +5 en severo
    eCw = 0.7 - sev * 0.2;                    // pared torÃ¡cica efectiva menor
  }

  // Sepsis (sin SDRA): FC aumenta â†’ si no sedado, mÃ¡s demanda ventilatoria
  if (params.sepsisActive && !params.isSedated) {
    pMusHz = 14 / 60 + clamp(params.sepsisSeverity, 0, 1) * 0.25; // hasta 29 rpm
    pMusAmp *= (1 + 0.5 * params.sepsisSeverity);
  }

  // ── OBSTRUCCION: EPOC y asma ───────────────────────────────────────────
  // Suben Raw, con lo que la constante de tiempo espiratoria se alarga y la
  // espiracion no alcanza a vaciar antes del siguiente ciclo. El volumen
  // atrapado genera auto-PEEP, y el auto-PEEP hace que el esfuerzo del
  // paciente no llegue a disparar: el esfuerzo inefectivo no se sortea, sale
  // solo de la mecanica. Es el mecanismo clasico del atrapamiento aereo.
  if (params.copdActive) {
    const sev = clamp(params.copdSeverity ?? 0.5, 0, 1);
    raw += sev * 18;                          // hasta ~23 cmH2O/L/s
    crs *= (1 + sev * 0.25);                  // hiperinsuflacion: Crs algo mayor
  }
  if (params.asthmaActive) {
    const sev = clamp(params.asthmaSeverity ?? 0.5, 0, 1);
    raw += sev * 28;                          // broncoespasmo severo domina Raw
  }

  // ═══ DRIVE RESPIRATORIO ═══════════════════════════════════════════════════
  // El esfuerzo del paciente es el sustrato de toda asincronia: sin esfuerzo
  // no hay conflicto con la maquina. Se modela en dos tiempos — primero los
  // estimulos que lo AUMENTAN, despues los que lo DEPRIMEN — porque un
  // paciente acidotico y sedado conserva parte del drive que la acidosis le
  // impone, mientras que uno paralizado no tiene ninguno haga lo que haga su
  // quimiorreceptor.

  // ── Estimulos quimicos y neurologicos que aumentan el drive ─────────────
  // Acidemia: el estimulo ventilatorio mas potente. pH 7.20 duplica el drive.
  const pH = params.pH ?? 7.40;
  if (pH < 7.35) {
    const acidosis = clamp((7.35 - pH) / 0.20, 0, 1);
    pMusAmp *= (1 + acidosis);
    pMusHz  += acidosis * 0.20;               // hasta +12 rpm
  }
  // Hipoxemia: por debajo de 60 mmHg el cuerpo carotideo dispara.
  const paO2 = params.paO2 ?? 95;
  if (paO2 < 60) {
    const hypoxemia = clamp((60 - paO2) / 30, 0, 1);
    pMusAmp *= (1 + hypoxemia * 0.7);
    pMusHz  += hypoxemia * 0.12;
  }
  // Hipertension intracraneal: hiperventilacion central neurogenica.
  const icp = params.icp ?? 10;
  if (icp > 20) {
    const htic = clamp((icp - 20) / 20, 0, 1);
    pMusAmp *= (1 + htic * 0.5);
    pMusHz  += htic * 0.15;
  }

  // ── Retroalimentacion negativa del quimiorreceptor ──────────────────────
  // Sin esto el lazo queda abierto: el paciente hiperventila, se alcaliniza y
  // sigue hiperventilando, con el pH subiendo sin techo. La supresion del
  // drive por alcalemia e hipocapnia es lo que cierra el control y devuelve
  // la ventilacion a su punto de equilibrio.
  if (pH > 7.45) {
    const alkalemia = clamp((pH - 7.45) / 0.20, 0, 1);
    pMusAmp *= (1 - alkalemia * 0.75);
    pMusHz  *= (1 - alkalemia * 0.55);
  }
  // La PaCO2 es el estimulo dominante del centro respiratorio: por debajo de
  // 35 mmHg el impulso cae deprisa, y cerca de 20 practicamente desaparece.
  const paCO2 = params.paCO2 ?? 40;
  if (paCO2 < 35) {
    const hypocapnia = clamp((35 - paCO2) / 15, 0, 1);
    pMusAmp *= (1 - hypocapnia * 0.80);
    pMusHz  *= (1 - hypocapnia * 0.60);
  } else if (paCO2 > 45) {
    // Hipercapnia: estimula, hasta la narcosis por CO2 que ya no modelamos.
    const hypercapnia = clamp((paCO2 - 45) / 35, 0, 1);
    pMusAmp *= (1 + hypercapnia * 0.8);
    pMusHz  += hypercapnia * 0.12;
  }

  // ── Factores que deprimen el drive ──────────────────────────────────────
  // Coma estructural: el GCS bajo refleja un drive central deprimido, y ese
  // drive bajo es el que Luo (Ann Intensive Care 2020) asocia a P0.1 baja y a
  // esfuerzo inefectivo en neurocriticos.
  const gcs = params.gcs ?? 15;
  if (gcs < 9) {
    pMusAmp *= clamp((gcs - 3) / 6, 0.15, 1);  // GCS 3 deja ~15 % del drive
  }
  // Sedacion graduada. La version binaria anterior anulaba el esfuerzo de
  // golpe; en la practica la depresion es dosis-dependiente y es justo el
  // rango intermedio —drive presente pero debil— el que mas asincronia
  // produce (Luo 2020: el AI sube con opioides y sedantes combinados).
  const sedation = params.sedationDepth ?? (params.isSedated ? 1 : 0);
  pMusAmp *= clamp(1 - sedation * 0.85, 0.05, 1);
  pMusHz  *= clamp(1 - sedation * 0.35, 0.4, 1);
  // Opioides: deprimen sobre todo la frecuencia.
  const respDep = clamp(params.respDepression ?? 0, 0, 1);
  pMusAmp *= (1 - respDep * 0.5);
  pMusHz  *= (1 - respDep * 0.55);

  // NMBA (vecuronio/cisatracurio pleno) â†’ esfuerzo muscular anulado.
  // La parlisis es el unico estado que lleva el drive a cero de verdad: un
  // paciente relajado no puede desincronizarse.
  pMusAmp *= clamp(1 - params.nmbaFraction / 0.6, 0, 1);
  if (params.nmbaFraction > 0.6) pMusAmp = 0;

  // Shock hemorrÃ¡gico: hipovolemia â†’ presiÃ³n intraabdominal â†“ pero sin cambio
  // intrÃ­nseco en compliance. Sin embargo la respuesta ventilatoria es de
  // taquipnea (acidosis lÃ¡ctica). Ya modelado vÃ­a pMusHz si sepsisActive.
  if (!params.isSedated && params.hypovolemicFraction > 0.10) {
    pMusHz += params.hypovolemicFraction * 0.2; // taquipnea compensatoria
    pMusAmp += params.hypovolemicFraction * 2;
  }

  return {
    crs: clamp(crs, 8, 120),
    raw: clamp(raw, 2, 40),
    eCw_eTot: clamp(eCw, 0.3, 0.8),
    // Techos fisiologicos del esfuerzo espontaneo sostenido. Los estimulos se
    // acumulan de forma multiplicativa (sepsis x acidemia x hipoxemia), asi
    // que sin un tope el drive se dispara por encima de lo que un paciente
    // puede mantener: por encima de ~35 rpm y ~12 cmH2O de esfuerzo continuo
    // lo que sigue es agotamiento muscular, no mas ventilacion.
    pMusAmplitude: clamp(pMusAmp, 0, 12),
    pMusDriveHz: clamp(pMusHz, 0.1, 0.58),   // 6â€“35 rpm
    vAnat: 2.2 * w,
  };
}

/**
 * Convierte el estado cardiovascular (Paw, Pplat, Ppl, SDRA) en un delta
 * hemodinÃ¡mico que el CardiovascularEngine debe aplicar al SV, CVP y PVR.
 *
 * Basado en:
 *   - Vieillard-Baron ICM 2016: TPP â†’ PVR, Ppl swing â†’ VR (venous return)
 *   - Berger AJP HCP 2016: PEEP â†‘ Pfs > RAP â†‘ en magnitudes similares;
 *     sÃ³lo reduce VR cuando RAP se aproxima a Pfs.
 *   - Lanspa Chest 2020: RV dysfunction 48% en sepsis temprana; Pplat > 27
 *     + sepsis duplica prob. ACP.
 */
export function computeHemodynamicCoupling(input: {
  pMean: number;       // cmHâ‚‚O
  pPlat: number;       // cmHâ‚‚O
  pplMean: number;     // cmHâ‚‚O
  pplSwing: number;    // cmHâ‚‚O
  peep: number;
  ardsActive: boolean;
  ardsSeverity: number;
  sepsisActive: boolean;
  sepsisSeverity: number;
}): {
  cvpTransmission: number;    // cmHâ‚‚O a aÃ±adir a CVP
  svPenalty: number;          // 0â€“1 (fracciÃ³n de SV perdida)
  pvrBonus: number;           // multiplicador RVP (1 = sin cambio)
  acpHighRisk: boolean;
  rvAfterloadFactor: number;  // 1+ â†’ mayor postcarga VD
} {
  // 1. TransmisiÃ³n Ppl â†’ CVP (0.5 Â· exceso sobre 10 cmHâ‚‚O, Berger 2016)
  const peepExcess = Math.max(0, input.peep - 10);
  const pplExcess = Math.max(0, input.pplMean - 5);
  const cvpTransmission = peepExcess * 0.5 + pplExcess * 0.3;

  // 2. PenalizaciÃ³n SV (precarga): funciÃ³n de Pmean
  //    Dual: Pmean reduce retorno venoso + Pplat reduce compliance VD
  const pmeanPen = Math.max(0, input.pMean - 10) * 0.025;
  const pplatPen = Math.max(0, input.pPlat - 25) * 0.015;
  const svPenalty = clamp(pmeanPen + pplatPen, 0, 0.70);

  // 3. PVR bonus â€” TPP eleva resistencia vascular pulmonar
  //    RelaciÃ³n no-lineal: bonus = 1 + Î±Â·(TPP âˆ’ 15)Â²  para TPP > 15
  //    Î± calibrado para bonus â‰ˆ 1.4 a TPP=25 (consistente con ICM 2016)
  const tppProxy = input.pPlat - input.pplMean;
  const pvrBonus = tppProxy > 15
    ? 1 + 0.004 * (tppProxy - 15) * (tppProxy - 15)
    : 1.0;

  // 4. Acute Cor Pulmonale: Pplat > 27 + (SDRA mod/sev OR sepsis+SDRA)
  const severeSubstrate =
    (input.ardsActive && input.ardsSeverity > 0.40) ||
    (input.ardsActive && input.sepsisActive);
  const acpHighRisk = input.pPlat > 27 && severeSubstrate;

  // 5. Postcarga VD combinada (PVR + ACP)
  const rvAfterloadFactor = pvrBonus * (acpHighRisk ? 1.25 : 1.0);

  return { cvpTransmission, svPenalty, pvrBonus, acpHighRisk, rvAfterloadFactor };
}




