import { create } from 'zustand';

// C6 commit 1 (1a) — "avanzar hasta": salta TIEMPO REAL sin comprimir
// TIEMPO SIMULADO. La fisica corre integra a dt fino (DT_BASE) — no se
// saltea ni se engrosa el paso. Implementacion real en CronosEngine
// (unico lugar con acceso directo al tick() que llama a todos los
// motores); este store solo expone la accion y el progreso para la UI.
export interface FastForwardSummary {
  simSecondsRequested: number;
  simSecondsAdvanced: number;
  aborted: boolean;
  abortReason: 'mortality' | 'criticalLab' | 'safetyCap' | null;
  labResultsArrived: number;
  imagingResultsArrived: number;
  mapBefore: number;
  mapAfter: number;
  lactateBefore: number;
  lactateAfter: number;
}

export interface FastForwardProgress {
  active: boolean;
  fracDone: number; // 0..1
}

interface TimeState {
  ticks:            number;
  simulatedElapsed: number;
  isRunning:        boolean;
  speedMultiplier:  number;
  fastForwardProgress: FastForwardProgress;

  // Métodos que usa MonitorApp.tsx
  start:         () => void;
  pause:         () => void;
  stop:          () => void;
  setRunning:    (v: boolean) => void;
  setSpeed:      (v: number)  => void;
  incrementTick: () => void;
  advanceTick:   (dt: number) => void;
  reset:         () => void;

  /** Avanza la simulacion N segundos simulados lo mas rapido que permita
   *  el bucle, sin animacion. El tiempo simulado transcurre integramente
   *  — no se saltea fisica (dt fino, mismo camino que this.tick()). */
  fastForward: (simSeconds: number) => Promise<FastForwardSummary>;
  setFastForwardProgress: (p: FastForwardProgress) => void;
}

export const useTimeStore = create<TimeState>((set, get) => ({
  ticks:            0,
  simulatedElapsed: 0,
  isRunning:        false,
  speedMultiplier:  1,
  fastForwardProgress: { active: false, fracDone: 0 },

  start:  () => set({ isRunning: true }),
  pause:  () => set({ isRunning: false }),
  stop:   () => set({ isRunning: false }),

  setRunning: (v) => set({ isRunning: v }),
  setSpeed:   (v) => set({ speedMultiplier: v }),

  incrementTick: () =>
    set((s) => ({
      ticks:            s.ticks + 1,
      simulatedElapsed: s.simulatedElapsed + 1,
    })),

  advanceTick: (dt) =>
    set((s) => ({
      ticks:            s.ticks + 1,
      simulatedElapsed: s.simulatedElapsed + dt,
    })),

  reset: () => set({ ticks: 0, simulatedElapsed: 0, fastForwardProgress: { active: false, fracDone: 0 } }),

  setFastForwardProgress: (p) => set({ fastForwardProgress: p }),

  fastForward: async (simSeconds) => {
    // Importacion dinamica — evita ciclo de modulos con CronosEngine
    // (que ya importa useTimeStore para leer/escribir el reloj).
    const { CronosEngine } = await import('../core/CronosEngine');
    set({ fastForwardProgress: { active: true, fracDone: 0 } });
    try {
      return await CronosEngine.getInstance().fastForward(simSeconds, (fracDone) => {
        get().setFastForwardProgress({ active: true, fracDone });
      });
    } finally {
      set({ fastForwardProgress: { active: false, fracDone: 1 } });
    }
  },
}));
