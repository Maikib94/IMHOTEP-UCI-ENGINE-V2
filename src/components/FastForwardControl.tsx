// src/components/FastForwardControl.tsx
//
// C6 commit 1 (1b, 1c) — control "AVANZAR HASTA": salta tiempo REAL sin
// comprimir tiempo SIMULADO (ver useTimeStore.fastForward / CronosEngine.
// fastForward). Decision del director clinico: NO hay reloj de laboratorio
// separado — el residente aprende a actuar con el resultado pendiente.
//
// NOTA DE INTEGRACION: este componente es AUTOCONTENIDO y no esta
// wireado en MonitorApp.tsx (archivo fragil para este PR, sin excepcion
// para UI de reloj — la unica excepcion otorgada fue el bucle interno de
// fastForward en CronosEngine.ts). El pedido dice "junto a los botones de
// velocidad", que viven en MonitorApp.tsx. Para renderizar este control
// hace falta UNA linea en MonitorApp.tsx:
//   import FastForwardControl from './components/FastForwardControl';
//   ...
//   <FastForwardControl />  (junto a los botones x1/x10/x60)
// Reportado, no aplicado — ver commit message.

import React, { useMemo, useState } from 'react';
import { useTimeStore } from '../store/useTimeStore';
import { usePatientStore } from '../store/usePatientStore';
import { usePharmacologyStore } from '../store/usePharmacologyStore';
import type { FastForwardSummary } from '../store/useTimeStore';

const MONO = "'JetBrains Mono', monospace";

interface Destination {
  key: string;
  label: string;
  etaMinutes: number | null; // null = no aplica (deshabilitado)
  simSeconds: number | null;
}

function fmtMin(simS: number): string {
  const m = Math.round(simS / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}min`;
}

function useDestinations(): Destination[] {
  const elapsed = useTimeStore(s => s.simulatedElapsed);
  const labOrders = usePatientStore(s => s.labOrders);
  const scheduledDoses = usePharmacologyStore(s => s.scheduledDoses);

  return useMemo(() => {
    const pendingLabs = labOrders.filter(o => o.result === null);
    const nextLab = pendingLabs.length > 0
      ? pendingLabs.reduce((a, b) => (a.readyAt < b.readyAt ? a : b))
      : null;

    const activeDoses = scheduledDoses.filter(d => d.active);
    const nextDose = activeDoses.length > 0
      ? activeDoses.reduce((a, b) => (a.nextDoseAtSimS < b.nextDoseAtSimS ? a : b))
      : null;

    const out: Destination[] = [
      {
        key: 'nextLab',
        label: nextLab ? `Próximo resultado (${nextLab.label})` : 'Próximo resultado de laboratorio',
        etaMinutes: nextLab ? Math.max(0, (nextLab.readyAt - elapsed) / 60) : null,
        simSeconds: nextLab ? Math.max(0, nextLab.readyAt - elapsed) : null,
      },
      {
        // C6 commit 1 (1b): ImagingEngine usa un timer de RELOJ REAL
        // (setTimeout), no simulatedElapsed — no hay un ETA en minutos
        // SIMULADOS que se pueda calcular de forma confiable. Se deja
        // deshabilitado y documentado en vez de mostrar un numero
        // inventado.
        key: 'nextImaging',
        label: 'Próximo estudio de imagen',
        etaMinutes: null,
        simSeconds: null,
      },
      {
        key: 'nextDose',
        label: nextDose ? `Próxima dosis (${nextDose.drug})` : 'Próxima dosis programada',
        etaMinutes: nextDose ? Math.max(0, (nextDose.nextDoseAtSimS - elapsed) / 60) : null,
        simSeconds: nextDose ? Math.max(0, nextDose.nextDoseAtSimS - elapsed) : null,
      },
      { key: 'plus15', label: '+15 min', etaMinutes: 15, simSeconds: 900 },
      { key: 'plus60', label: '+1 h', etaMinutes: 60, simSeconds: 3600 },
    ];
    return out;
  }, [elapsed, labOrders, scheduledDoses]);
}

function summaryText(s: FastForwardSummary): string {
  const mins = Math.round(s.simSecondsAdvanced / 60);
  const parts: string[] = [`Avanzaste ${mins} min.`];
  if (s.labResultsArrived > 0) {
    parts.push(`Llegaron ${s.labResultsArrived} resultado${s.labResultsArrived > 1 ? 's' : ''}.`);
  }
  if (s.imagingResultsArrived > 0) {
    parts.push(`${s.imagingResultsArrived} estudio${s.imagingResultsArrived > 1 ? 's' : ''} de imagen listo${s.imagingResultsArrived > 1 ? 's' : ''}.`);
  }
  const mapDelta = s.mapAfter - s.mapBefore;
  if (Math.abs(mapDelta) >= 1) {
    parts.push(`MAP ${mapDelta < 0 ? 'bajó' : 'subió'} de ${s.mapBefore.toFixed(0)} a ${s.mapAfter.toFixed(0)}.`);
  }
  if (s.aborted) {
    const reason = s.abortReason === 'mortality' ? 'el paciente falleció'
      : s.abortReason === 'criticalLab' ? 'llegó un resultado crítico'
      : s.abortReason === 'safetyCap' ? 'se alcanzó el tope de seguridad (4h)'
      : 'se interrumpió';
    parts.push(`Detenido antes de lo pedido — ${reason}.`);
  }
  return parts.join(' ');
}

export default function FastForwardControl(): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState<FastForwardSummary | null>(null);
  const destinations = useDestinations();
  const progress = useTimeStore(s => s.fastForwardProgress);
  const fastForward = useTimeStore(s => s.fastForward);

  const handlePick = async (dest: Destination) => {
    if (dest.simSeconds === null) return;
    setMenuOpen(false);
    setSummary(null);
    const result = await fastForward(dest.simSeconds);
    setSummary(result);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', fontFamily: MONO }}>
      <button
        type="button"
        onClick={() => setMenuOpen(o => !o)}
        disabled={progress.active}
        style={{
          background: progress.active ? 'rgba(56,189,248,0.08)' : 'rgba(56,189,248,0.14)',
          border: '1px solid rgba(56,189,248,0.4)', borderRadius: 5,
          color: '#38bdf8', fontFamily: MONO, fontSize: '0.55rem', fontWeight: 800,
          padding: '5px 12px', cursor: progress.active ? 'default' : 'pointer',
          letterSpacing: '0.05em',
        }}
      >
        {progress.active ? `AVANZANDO… ${Math.round(progress.fracDone * 100)}%` : '⏩ AVANZAR HASTA'}
      </button>

      {menuOpen && !progress.active && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 4000,
          background: '#0a1220', border: '1px solid rgba(56,189,248,0.3)',
          borderRadius: 6, minWidth: 240, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {destinations.map(d => {
            const disabled = d.simSeconds === null;
            return (
              <button
                key={d.key}
                type="button"
                disabled={disabled}
                onClick={() => handlePick(d)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'none', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: disabled ? '#3f4a5f' : '#c8d6e5',
                  fontFamily: MONO, fontSize: '0.52rem',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <span>{d.label}</span>
                <span style={{ color: disabled ? '#3f4a5f' : '#38bdf8', marginLeft: 12 }}>
                  {d.simSeconds === null ? '—' : `ETA ${fmtMin(d.simSeconds)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {progress.active && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, width: 200, height: 4,
          background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.round(progress.fracDone * 100)}%`, height: '100%',
            background: '#38bdf8', transition: 'width 120ms linear',
          }} />
        </div>
      )}

      {/* C6 commit 1 (1c) — resumen post-avance. Sin esto el alumno pierde
          el hilo de la evolucion durante el salto de tiempo real. */}
      {summary && (
        <div
          onClick={() => setSummary(null)}
          style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 4000, minWidth: 260,
            background: '#0a1220', border: '1px solid rgba(56,189,248,0.35)',
            borderRadius: 6, padding: '10px 12px', cursor: 'pointer',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ color: '#38bdf8', fontSize: '0.5rem', fontWeight: 800, marginBottom: 4, letterSpacing: '0.06em' }}>
            RESUMEN DEL AVANCE
          </div>
          <div style={{ color: '#c8d6e5', fontSize: '0.52rem', lineHeight: 1.5 }}>
            {summaryText(summary)}
          </div>
          <div style={{ color: '#6b7a99', fontSize: '0.44rem', marginTop: 6 }}>
            (tocar para cerrar)
          </div>
        </div>
      )}
    </div>
  );
}
