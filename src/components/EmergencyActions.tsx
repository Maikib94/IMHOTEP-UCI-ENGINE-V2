// src/components/EmergencyActions.tsx
//
// Acciones criticas siempre visibles en la barra superior.
//
// MOTIVO: en un deterioro brusco no hay tiempo de abrir un acordeon, localizar
// la droga entre decenas de filas identicas y pulsar el stepper veinte veces.
// Estas cuatro dejan el tratamiento puesto de un click, en la dosis de
// referencia, sin salir de donde se esta mirando al paciente.
//
// El boton de busqueda esta aqui a proposito: un atajo de teclado que nadie
// sabe que existe no resuelve nada, asi que la paleta necesita una puerta
// visible ademas del Ctrl+K.
/* eslint-disable react/forbid-dom-props */

import React from 'react';
import { usePharmacologyStore } from '../store/usePharmacologyStore';
import { usePatientStore } from '../store/usePatientStore';
import { dosesFor } from '../data/clinicalDoses';

interface EmergencyActionsProps {
  onOpenPalette: () => void;
}

/** Ultimo escalon de dosis de un farmaco (el alto), en su unidad. */
function topDose(drug: 'adrenaline' | 'noradrenaline'): number {
  const steps = dosesFor(drug);
  return steps.length ? steps[steps.length - 1].value : 0.5;
}
/** Primer escalon (dosis de inicio). */
function startDose(drug: 'adrenaline' | 'noradrenaline'): number {
  const steps = dosesFor(drug);
  return steps.length ? steps[0].value : 0.05;
}

export default function EmergencyActions({ onOpenPalette }: EmergencyActionsProps) {
  const setInfusionRate = usePharmacologyStore(s => s.setInfusionRate);
  const rates           = usePharmacologyStore(s => s.infusionRates);
  const ventConnected   = usePatientStore(s => s.isVentilatorConnected);
  const fio2            = usePatientStore(s => s.ventilator.fio2);
  const setVent         = usePatientStore(s => s.setVentilatorSettings);

  const adreOn  = (rates['adrenaline'] ?? 0) > 0;
  const noradOn = (rates['noradrenaline'] ?? 0) > 0;
  const fio2Max = ventConnected && fio2 >= 0.99;

  const btn = (active: boolean, accent: string): React.CSSProperties => ({
    background: active ? `${accent}22` : '#120a0a',
    border: `1px solid ${active ? accent : 'rgba(239,68,68,0.28)'}`,
    borderRadius: 4,
    color: active ? accent : '#f87171',
    fontWeight: 800,
    fontSize: '0.5rem',
    letterSpacing: '0.04em',
    padding: '3px 7px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 6, paddingLeft: 6, borderLeft: '1px solid rgba(239,68,68,0.22)' }}>
      <span style={{
        fontSize: '0.4rem', fontWeight: 800, letterSpacing: '0.12em',
        color: '#7f1d1d', fontFamily: 'ui-monospace, monospace', marginRight: 1,
      }}>
        URGENCIA
      </span>

      <button
        type="button"
        onClick={() => setInfusionRate('adrenaline', topDose('adrenaline'))}
        title={`Adrenalina ${topDose('adrenaline')} mcg/kg/min — dosis alta para parada o shock refractario`}
        style={btn(adreOn, '#ef4444')}
      >
        ADRE
      </button>

      <button
        type="button"
        onClick={() => setInfusionRate('noradrenaline', startDose('noradrenaline'))}
        title={`Noradrenalina ${startDose('noradrenaline')} mcg/kg/min — inicio en hipotensión`}
        style={btn(noradOn, '#fb7185')}
      >
        NORAD
      </button>

      <button
        type="button"
        onClick={() => setVent({ fio2: 1.0 })}
        disabled={!ventConnected}
        title={ventConnected
          ? 'FiO₂ 100% — desaturación aguda'
          : 'Requiere ventilador conectado'}
        style={{
          ...btn(fio2Max, '#f59e0b'),
          opacity: ventConnected ? 1 : 0.35,
          cursor: ventConnected ? 'pointer' : 'not-allowed',
        }}
      >
        FiO₂ 100
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        title="Buscar cualquier fármaco, dosis o panel — atajo Ctrl+K"
        style={{
          background: 'rgba(34,211,238,0.08)',
          border: '1px solid rgba(34,211,238,0.3)',
          borderRadius: 4, color: '#22d3ee',
          fontWeight: 700, fontSize: '0.5rem', padding: '3px 7px',
          cursor: 'pointer', marginLeft: 3, whiteSpace: 'nowrap',
        }}
      >
        ⌕ BUSCAR <span style={{ opacity: 0.6, fontSize: '0.42rem' }}>Ctrl+K</span>
      </button>
    </div>
  );
}
