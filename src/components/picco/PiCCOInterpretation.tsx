// src/components/picco/PiCCOInterpretation.tsx
//
// Panel de lectura hemodinamica del PiCCO.
//
// El monitor ya mostraba diecisiete variables con su rango. Este panel responde
// a lo que en realidad se pregunta delante de ese monitor: que tipo de shock
// es, de donde sale el agua pulmonar y si dar volumen va a servir de algo.
//
// El modo docente esta apagado por defecto a proposito: leer el patron es el
// ejercicio, y el panel lo revela cuando se pide, no antes.
/* eslint-disable react/forbid-dom-props */

import React, { useState } from 'react';
import { usePatientStore }    from '../../store/usePatientStore';
import { useMonitoringStore } from '../../store/useMonitoringStore';
import { usePharmacologyStore } from '../../store/usePharmacologyStore';
import {
  interpretPicco, type Severity, type SvvValidity,
} from '../../core/piccoInterpretation';

const TONE: Record<Severity, { fg: string; bg: string; border: string }> = {
  ok:    { fg: '#34d399', bg: 'rgba(52,211,153,0.07)',  border: 'rgba(52,211,153,0.28)' },
  warn:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.30)' },
  alert: { fg: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.32)' },
};

function Block({ tone, title, body, caption }: {
  tone: Severity; title: string; body: string; caption?: string;
}) {
  const t = TONE[tone];
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 7,
      padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{
        fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.14em',
        color: '#64748b', fontFamily: 'ui-monospace, monospace',
      }}>
        {title}
      </div>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: t.fg, lineHeight: 1.25 }}>
        {body}
      </div>
      {caption && (
        <div style={{ fontSize: '0.44rem', color: '#94a3b8', lineHeight: 1.45 }}>
          {caption}
        </div>
      )}
    </div>
  );
}

export default function PiCCOInterpretation() {
  const [teach, setTeach] = useState(false);
  const snap = useMonitoringStore(s => s.piccoSnapshot);
  const vent = usePatientStore(s => s.ventilator);
  const armOn = usePatientStore(s => s.isVentilatorConnected);
  const weight = usePatientStore(s => s.vitals.weight ?? 70);
  const sedation = usePharmacologyStore(s => s.systemicEffects.sedation);
  const nmba     = usePharmacologyStore(s => s.systemicEffects.nmba);

  if (!snap) {
    return (
      <div style={{
        padding: '10px 12px', border: '1px dashed rgba(255,255,255,0.10)',
        borderRadius: 8, color: '#475569', fontSize: '0.5rem', textAlign: 'center',
      }}>
        Realice una termodilución para obtener la lectura hemodinámica
      </div>
    );
  }

  // El SVV solo predice respuesta a volumen bajo condiciones estrictas. El
  // esfuerzo espontaneo es la que mas se pasa por alto, y el motor ya lo
  // modela, asi que se puede comprobar de verdad en vez de suponerlo.
  // El esfuerzo se deriva de sedacion y bloqueo neuromuscular, que es lo que
  // lo determina en deriveMechanicsFromPathology: un paciente relajado no
  // esfuerza, y uno sedado esfuerza menos de forma graduada. Basta para
  // decidir si el SVV es creible, que es todo lo que se pregunta aqui.
  //
  // La arritmia queda fuera: el modelo no representa ritmos no sinusales
  // todavia, y comprobar algo que no se simula seria dar una garantia falsa.
  // En un paciente real es la cuarta condicion a verificar.
  const effort = 3.5 * Math.max(0, 1 - sedation * 0.85) * Math.max(0, 1 - nmba / 0.6);
  const validity: SvvValidity = {
    ventilated: armOn,
    vtPerKg: weight > 0 ? (vent.vt ?? 0) / weight : 0,
    patientEffort: effort,
    arrhythmia: false,
  };

  const r = interpretPicco(snap, validity);
  const fluidTone: Severity =
    r.fluidResponse === 'probable'   ? 'warn'
    : r.fluidResponse === 'improbable' ? 'ok'
    : 'warn';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.16em',
          color: '#64748b', fontFamily: 'ui-monospace, monospace',
        }}>
          LECTURA HEMODINÁMICA
        </span>
        <button
          type="button"
          onClick={() => setTeach(v => !v)}
          title={teach
            ? 'Ocultar el razonamiento y el plan'
            : 'Modo docente: mostrar por qué y qué hacer'}
          style={{
            padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
            background: teach ? 'rgba(34,211,238,0.12)' : 'transparent',
            border: `1px solid ${teach ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.10)'}`,
            color: teach ? '#22d3ee' : '#475569',
            fontSize: '0.38rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace',
          }}
        >
          {teach ? 'DOCENTE ON' : 'DOCENTE'}
        </button>
      </div>

      <Block
        tone={r.profileSeverity}
        title="PERFIL"
        body={r.profileLabel}
        caption={teach ? r.profileWhy : undefined}
      />

      <Block
        tone={r.edemaSeverity}
        title="AGUA PULMONAR"
        body={r.edemaLabel}
        caption={teach ? r.edemaWhy : undefined}
      />

      <Block
        tone={fluidTone}
        title="RESPUESTA A VOLUMEN"
        body={r.fluidLabel}
        caption={teach ? r.fluidWhy : undefined}
      />

      {teach && r.actions.length > 0 && (
        <div style={{
          border: '1px solid rgba(34,211,238,0.22)', borderRadius: 7,
          background: 'rgba(34,211,238,0.05)', padding: '6px 8px',
        }}>
          <div style={{
            fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.14em',
            color: '#0e7490', fontFamily: 'ui-monospace, monospace', marginBottom: 3,
          }}>
            CONDUCTA SUGERIDA
          </div>
          {r.actions.map((a, i) => (
            <div key={i} style={{
              fontSize: '0.46rem', color: '#a5f3fc', lineHeight: 1.5,
              display: 'flex', gap: 5,
            }}>
              <span style={{ color: '#0e7490' }}>{i + 1}.</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
