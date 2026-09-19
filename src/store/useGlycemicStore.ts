// src/store/useGlycemicStore.ts
//
// Estado del modelo glucémico ICING-adaptado (Bergman extendido).
// Separa la glucemia CONTINUA (interna, cada tick) del HGT DISCRETO
// (snapshot con ruido de glucómetro, σ=5 mg/dL).
//
// Ref: Lin J et al. Comput Methods Programs Biomed 2011 (ICING model);
//      ADA 2024 (umbrales hipoglicemia); NICE-SUGAR NEJM 2009 (target 140-180 mg/dL).

import { create } from 'zustand';
import { rand } from '../core/rng';

export type HGTFrequency = '1h' | '2h' | '4h' | '6h' | '12h' | 'off';

export interface HGTRecord {
  id:        string;             // contador monotónico — determinista entre corridas
  simTimeS:  number;             // useTimeStore.simulatedElapsed al momento del HGT (C1.9)
  glucoseMg: number;             // mg/dL medido (con ruido)
  source:    'scheduled' | 'manual' | 'critical_alert';
}

// Box-Muller para ruido glucómetro σ=5 mg/dL
function gaussNoise(sigma = 5): number {
  const u = Math.max(1e-10, rand('glucometer'));
  const v = rand('glucometer');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

let _hgtCounter = 0;

interface GlycemicState {
  // ── Modelo interno (actualizado cada tick por GlycemicEngine) ────────────
  bgContinuous:  number;    // mg/dL — Bergman G
  remoteInsulinX: number;   // 1/min — Bergman X (efecto remoto insulina)
  plasmaInsulin:  number;   // mU/L  — Bergman I

  // ── Display discreto (HGT) ────────────────────────────────────────────────
  bgDisplayed:   number;    // mg/dL — último HGT registrado
  hgtFrequency:  HGTFrequency;
  nextHgtAtSimS: number | null;  // simulatedElapsed del próximo HGT programado (C1.9)
  hgtHistory:    HGTRecord[];    // máx 24 registros (rolling)

  // ── Alertas ────────────────────────────────────────────────────────────────
  hypoAlert:       boolean;   // bgDisplayed < 70
  hyperAlert:      boolean;   // bgDisplayed > 180
  severHypoAlert:  boolean;   // bgDisplayed < 54  (ADA cutoff severo)
  severHyperAlert: boolean;   // bgDisplayed > 250

  // ── Sugerencia de frecuencia por corticoides ──────────────────────────────
  corticoidHGTSuggestion: boolean;  // true cuando se inicia un corticoide

  // ── Acciones ───────────────────────────────────────────────────────────────
  setHgtFrequency:       (f: HGTFrequency) => void;
  triggerManualHgt:      (source?: HGTRecord['source'], atSimS?: number) => HGTRecord;
  recordContinuous:      (bg: number, X: number, I: number) => void;
  setCorticoidSuggestion:(v: boolean) => void;
  reset:                 () => void;
}

const INITIAL_STATE = {
  bgContinuous:  99,
  remoteInsulinX: 0,
  plasmaInsulin:  5,
  bgDisplayed:   99,
  hgtFrequency:  '4h' as HGTFrequency,
  nextHgtAtSimS: null,
  hgtHistory:    [] as HGTRecord[],
  hypoAlert:       false,
  hyperAlert:      false,
  severHypoAlert:  false,
  severHyperAlert: false,
  corticoidHGTSuggestion: false,
};

function computeAlerts(bg: number) {
  return {
    hypoAlert:       bg < 70,
    hyperAlert:      bg > 180,
    severHypoAlert:  bg < 54,
    severHyperAlert: bg > 250,
  };
}

export const useGlycemicStore = create<GlycemicState>((set, get) => ({
  ...INITIAL_STATE,

  setHgtFrequency: (f) => {
    const nextAt = f === 'off' ? null
      : (null as number | null); // nextHgtAtSimS set by CronosEngine on first schedule
    set({ hgtFrequency: f, nextHgtAtSimS: nextAt });
    // If turning on, schedule first HGT from current simulatedElapsed
    // (CronosEngine will set nextHgtAtSimS on its first check)
  },

  triggerManualHgt: (source = 'manual', atSimS = 0) => {
    const { bgContinuous, hgtHistory } = get();
    const noisy = Math.round(bgContinuous + gaussNoise(5));
    const clamped = Math.max(30, Math.min(600, noisy));
    // Contador monotónico puro — nada de Date.now(): dos corridas con la
    // misma secuencia de llamadas deben producir los mismos IDs (C1.7 commit 4).
    const id = `hgt-${++_hgtCounter}`;
    const record: HGTRecord = {
      id, simTimeS: atSimS, glucoseMg: clamped, source,
    };
    const alerts = computeAlerts(clamped);
    set({
      bgDisplayed: clamped,
      hgtHistory: [...hgtHistory.slice(-23), record],
      ...alerts,
    });
    return record;
  },

  recordContinuous: (bg, X, I) => {
    const clamped = Math.max(30, Math.min(600, bg));
    set({ bgContinuous: clamped, remoteInsulinX: X, plasmaInsulin: I });
  },

  setCorticoidSuggestion: (v) => set({ corticoidHGTSuggestion: v }),

  reset: () => {
    _hgtCounter = 0;
    set({ ...INITIAL_STATE });
  },
}));
