// src/core/CronosEngine.ts
// CAMBIO: PharmacologyEngine agregado como el motor PK/PD clínico.
// Orden actualizado:
// PathologyEngine → MicrobiologyEngine → PharmacologyEngine → CardiovascularEngine
// → RespiratoryEngine → AcidBaseEngine → RenalEngine → NeuroEngine → LabEngine
// → AcuteMortalityEngine (último — lee vitals FINALES del tick)

import { useTimeStore } from '../store/useTimeStore';
import { usePatientStore } from '../store/usePatientStore';
import { useGlycemicStore } from '../store/useGlycemicStore';
import { MicrobiologyEngine } from './MicrobiologyEngine';
import { InfectoEngine } from './InfectoEngine';
import { PathologyEngine } from './PathologyEngine';
import { PharmacologyEngine } from './PharmacologyEngine';
import { CardiovascularEngine } from './CardiovascularEngine';
import { RespiratoryEngine } from './RespiratoryEngine';
import { AcidBaseEngine } from './AcidBaseEngine';
import { RenalEngine } from './RenalEngine';
import { NeuroEngine } from './NeuroEngine';
import { LabEngine } from './LabEngine';
import { PrognosisEngine } from './PrognosisEngine';
import { GlycemicEngine } from './GlycemicEngine';
import { useMonitoringStore } from '../store/useMonitoringStore';
import { usePharmacologyStore } from '../store/usePharmacologyStore';
import { CrosstalkEngine }     from './CrosstalkEngine';
import { AcuteMortalityEngine } from './AcuteMortalityEngine';
import { useMortalityStore } from '../store/useMortalityStore';
import { useImagingStore } from './ImagingEngine';
import type { FastForwardSummary } from '../store/useTimeStore';

const TICKS_PER_REAL_SECOND = 240;
// DT_BASE: sim-seconds per tick. With 240 ticks/real-sec, DT_BASE=1/240
// gives exactly 1 sim-sec per real-sec at speedMultiplier=1 (real-time).
// x10 → 10 sim-sec/real-sec, x60 → 60 sim-sec/real-sec.
const DT_BASE = 1.0 / TICKS_PER_REAL_SECOND;
const MAX_ELAPSED_S = 0.1;

// Minimum real-time interval between React store "vitals flush" notifications.
// Engines write to internal state every tick; the UI only needs 10 Hz.
const VITALS_PUBLISH_INTERVAL_MS = 100;

export class CronosEngine {
  private static instance: CronosEngine | null = null;
  private rafId: number = 0;
  private lastTime: number = 0;
  private accumulator: number = 0;
  private lastVitalsPublishMs: number = 0;

  private constructor() { }

  public static getInstance(): CronosEngine {
    if (CronosEngine.instance === null)
      CronosEngine.instance = new CronosEngine();
    return CronosEngine.instance;
  }

  /** Reset de estado de simulación (accumulator, cadencia de publicación).
   *  NO toca rafId: es un handle de requestAnimationFrame activo gestionado
   *  por start()/stop()/destroy() — resetearlo aquí dejaría el frame en
   *  vuelo huérfano sin forma de cancelarlo. */
  public reset(): void {
    this.lastTime = 0;
    this.accumulator = 0;
    this.lastVitalsPublishMs = 0;
  }

  public initialize(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  public start(): void { this.initialize(); }
  public stop(): void { cancelAnimationFrame(this.rafId); this.rafId = 0; }
  public destroy(): void { this.stop(); }
  public pause(): void { this.stop(); }

  // ─── C6 commit 1 (1a) — "avanzar hasta" ────────────────────────────────────
  //
  // Salta TIEMPO REAL sin comprimir TIEMPO SIMULADO: corre this.tick(dt) en
  // un bucle acotado, dt = DT_BASE SIEMPRE (nunca un dt grueso — C1.7
  // demostro que la fisica no es invariante en dt todavia; usar el dt fino
  // garantiza el MISMO resultado que reproducir a x1, no una aproximacion).
  // Cede al event loop cada FF_YIELD_EVERY_TICKS para no congelar la UI.
  //
  // Aborta si: dispara AcuteMortalityEngine, llega un resultado de
  // laboratorio critico (flag 'C'), o se supera el tope de seguridad.
  private static readonly FF_YIELD_EVERY_TICKS = 2000;
  private static readonly FF_SAFETY_CAP_S = 4 * 3600; // 4h sim por invocacion
  private static readonly FF_CRITICAL_CHECK_EVERY_TICKS = 240; // ~1 s sim

  /** Hook minimo para el test de equivalencia de fastForward (C6 commit 1
   *  entregable): permite reproducir manualmente la misma secuencia de
   *  this.tick(dt) que fastForward() ejecuta internamente, para comparar
   *  el estado final tick-a-tick contra "reproducir a x1" sin esperar
   *  minutos reales en el test. */
  public simulateTick(dt: number): void { this.tick(dt); }

  public async fastForward(
    simSeconds: number,
    onProgress?: (fracDone: number) => void,
  ): Promise<FastForwardSummary> {
    const requested = Math.max(0, simSeconds);
    const capped = Math.min(requested, CronosEngine.FF_SAFETY_CAP_S);
    const steps = Math.max(1, Math.round(capped / DT_BASE));

    // Pausar el bucle rAF normal — sin esto, fastForward() y this.loop()
    // llamarian this.tick(dt) concurrentemente y duplicarian ticks.
    const wasRunning = useTimeStore.getState().isRunning;
    this.stop();

    const patStart = usePatientStore.getState();
    const mapBefore = patStart.vitals.meanArterialPressure;
    const lactateBefore = patStart.vitals.lactate;
    const knownResultIds = new Set(patStart.labOrders.filter(o => o.result !== null).map(o => o.id));
    const imagingBefore = useImagingStore.getState().completed.length;

    let aborted = false;
    let abortReason: FastForwardSummary['abortReason'] = null;
    let stepsRun = 0;
    let labResultsArrived = 0;

    try {
      for (let i = 0; i < steps; i++) {
        if (usePatientStore.getState().ventilator.isPaused) break;

        this.tick(DT_BASE);
        stepsRun++;

        if (useMortalityStore.getState().isDeceased) {
          aborted = true; abortReason = 'mortality'; break;
        }

        if (i % CronosEngine.FF_CRITICAL_CHECK_EVERY_TICKS === 0) {
          const nowFulfilled = usePatientStore.getState().labOrders.filter(o => o.result !== null);
          const newlyArrived = nowFulfilled.filter(o => !knownResultIds.has(o.id));
          if (newlyArrived.length > 0) {
            for (const o of newlyArrived) knownResultIds.add(o.id);
            labResultsArrived += newlyArrived.length;
            const hasCritical = newlyArrived.some(o => Object.values(o.result!.flags).includes('C'));
            if (hasCritical) { aborted = true; abortReason = 'criticalLab'; break; }
          }
        }

        if (i % CronosEngine.FF_YIELD_EVERY_TICKS === 0) {
          onProgress?.(i / steps);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      // Barrido final — captura resultados llegados desde el ultimo check.
      const finalFulfilled = usePatientStore.getState().labOrders.filter(o => o.result !== null);
      const finalNew = finalFulfilled.filter(o => !knownResultIds.has(o.id));
      labResultsArrived += finalNew.length;

      if (!aborted && capped < requested) {
        aborted = true; abortReason = 'safetyCap';
      }
    } finally {
      if (wasRunning) this.start();
    }

    const patEnd = usePatientStore.getState();
    onProgress?.(1);
    return {
      simSecondsRequested: requested,
      simSecondsAdvanced: stepsRun * DT_BASE,
      aborted, abortReason,
      labResultsArrived,
      imagingResultsArrived: useImagingStore.getState().completed.length - imagingBefore,
      mapBefore, mapAfter: patEnd.vitals.meanArterialPressure,
      lactateBefore, lactateAfter: patEnd.vitals.lactate,
    };
  }

  private loop = (timestamp: number): void => {
    const timeStore = useTimeStore.getState();

    if (!timeStore.isRunning) {
      this.lastTime = timestamp;
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const elapsed = Math.min((timestamp - this.lastTime) / 1000, MAX_ELAPSED_S);
    this.lastTime = timestamp;
    this.accumulator += elapsed * TICKS_PER_REAL_SECOND;

    const ticksToRun = Math.floor(this.accumulator);
    this.accumulator -= ticksToRun;

    const dt = DT_BASE * timeStore.speedMultiplier;
    for (let i = 0; i < ticksToRun; i++) {
      this.tick(dt);
    }

    // Throttle React vitals re-renders to 10 Hz (100ms real time).
    // Engines compute internally every tick; this flush triggers UI subscriptions.
    if (timestamp - this.lastVitalsPublishMs >= VITALS_PUBLISH_INTERVAL_MS) {
      this.lastVitalsPublishMs = timestamp;
      usePatientStore.getState().publishVitals();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private tick(dt: number): void {
    if (usePatientStore.getState().ventilator.isPaused) return;

    useTimeStore.getState().advanceTick(dt);

    // Orden clínico:
    //   Pharma → Renal (drena vol) → Resp → Cardio (lee vol+pMean) → AcidBase
    //   RenalEngine ANTES de Cardiovascular: volemia actualizada en mismo tick.
    //   Bellomo Lancet 2012; Schrier NEJM 2007.
    MicrobiologyEngine.getInstance().update(dt);
    InfectoEngine.getInstance().update(dt);               // ← cobertura empírica → debuffs
    PathologyEngine.getInstance().update(dt);
    PharmacologyEngine.getInstance().update(dt);
    RenalEngine.getInstance().update(dt);                 // ← drena bloodVolume por diuresis
    RespiratoryEngine.getInstance().update(dt);           // ← escribe pMean
    CardiovascularEngine.getInstance().updateHemodynamics(dt); // ← lee vol+pMean+debuffs

    // ─── HIDRATACIÓN DE MANTENIMIENTO ───────────────────────────────────────────
    //   30% de retención IV en críticos (Hahn RG et al., BJA 2018-2021, volume kinetics).
    {
      const pat = usePatientStore.getState();
      if (pat.maintenanceFluidRate_mLh > 0) {
        const delta_mL = (pat.maintenanceFluidRate_mLh / 3600) * dt;
        pat.addMaintenanceTick(delta_mL);
      }
    }
    AcidBaseEngine.getInstance().update(dt);
    NeuroEngine.getInstance().update(dt);
    LabEngine.getInstance().update();
    PrognosisEngine.getInstance().update(dt);
    GlycemicEngine.getInstance().update(dt);
    CrosstalkEngine.getInstance().update(dt); // ECMO ↔ Vent + CRRT ↔ Pharma/Electrolytes

    // ── MORTALIDAD AGUDA (siempre al final — lee vitals finales del tick) ──────
    // AcuteMortalityEngine evalúa 13 causas de muerte por umbral fisiológico.
    // Lee vitals FINALES (post-cardiovascular, respiratory, renal, acidbase).
    // Si dispara muerte, pausa simulación y notifica PrognosisStore.
    // Tiene prioridad sobre PrognosisEngine si ambos coinciden en el mismo tick.
    AcuteMortalityEngine.getInstance().update(dt);

    // ── 5.C: HGT programado ───────────────────────────────────────────────────
    // Dispara snapshot discreto (con ruido glucómetro σ=5 mg/dL) según frecuencia
    // configurada. CronosEngine es el "reloj" que decide cuándo medir.
    // C1.9: todo scheduling clínico usa simulatedElapsed — NUNCA ticks (ticks
    // avanza a 240/s real fijo, independiente de speedMultiplier; ver commit
    // 0f397e8, semántica de reloj confirmada empíricamente).
    const glyc = useGlycemicStore.getState();
    const currentSimS = useTimeStore.getState().simulatedElapsed;
    const freq = glyc.hgtFrequency;
    if (freq !== 'off') {
      if (glyc.nextHgtAtSimS === null) {
        // Primera vez: programar siguiente medición
        const intervalH = parseInt(freq, 10);
        useGlycemicStore.setState({ nextHgtAtSimS: currentSimS + intervalH * 3600 });
      } else if (currentSimS >= glyc.nextHgtAtSimS) {
        // Disparar HGT programado y reagendar
        glyc.triggerManualHgt('scheduled', currentSimS);
        const intervalH = parseInt(freq, 10);
        useGlycemicStore.setState({
          nextHgtAtSimS: currentSimS + intervalH * 3600,
        });

        // ── 5.D: Alertas críticas → HGT adicional inmediato si severo ──────
        // Si BG < 54 o > 250, disparar alerta crítica (ya computada en store)
        const bg = glyc.bgContinuous;
        if (bg < 54 || bg > 250) {
          useGlycemicStore.getState().triggerManualHgt('critical_alert', currentSimS);
        }
      }
    }

    // ── DOSIS A HORARIO (Fase 1.B) ───────────────────────────────────────────
    // Dispara bolos programados cuando simulatedElapsed alcanza nextDoseAtSimS.
    // Usa queueSlowBolus (5 min administración) para simular infusión IV corta.
    {
      const ph   = usePharmacologyStore.getState();
      const pEng = PharmacologyEngine.getInstance();
      ph.scheduledDoses.forEach(s => {
        if (!s.active) return;
        if (currentSimS >= s.nextDoseAtSimS) {
          pEng.queueSlowBolus(s.drug, s.doseMg, 300);  // 300 s ≈ 5 min
          usePharmacologyStore.setState(state => ({
            scheduledDoses: state.scheduledDoses.map(x =>
              x.id === s.id
                ? { ...x, nextDoseAtSimS: currentSimS + x.intervalH * 3600 }
                : x
            ),
          }));
        }
      });
    }

    // ── ALARMA RECALIBRACIÓN PiCCO (3.B) ─────────────────────────────────────
    // Huber BMC Anesthesiol 2015: PE < 30% solo hasta ~8h sin recalibración.
    // Hamzaoui CCM 2008: recalibración 1-2h en paciente inestable.
    const mon = useMonitoringStore.getState();
    if (mon.invasiveMode === 'picco' && mon.lastThermodilutionSimS !== null) {
      const simSSince    = currentSimS - mon.lastThermodilutionSimS;
      const eightHoursS  = 8 * 3600;
      if (simSSince >= eightHoursS && !mon.thermodilutionAlarmActive) {
        useMonitoringStore.setState({ thermodilutionAlarmActive: true });
      }
    }

    // ── SVV sampling para mini-trend (cada 30 sim-segundos) ────────────────
    // simulatedElapsed es float — no se puede usar "% 30 === 0"; se compara
    // contra el ultimo sample registrado (mismo patron que el resto del reloj).
    if (mon.invasiveMode === 'picco') {
      const lastSvvAt = mon.lastSvvSampleSimS;
      if (lastSvvAt === null || currentSimS - lastSvvAt >= 30) {
        const svv = mon.piccoSnapshot?.svv;
        if (svv !== undefined) mon.addSvvSample(svv);
        useMonitoringStore.setState({ lastSvvSampleSimS: currentSimS });
      }
    }
  }
}