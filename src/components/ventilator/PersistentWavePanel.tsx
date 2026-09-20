// src/components/ventilator/PersistentWavePanel.tsx
// Three-channel ARM waveform panel: Paw / Flow / Volume.
// Mounts PersistentWaveCanvas × 3, each taking 1/3 of available height.

import React, { useRef, useEffect, useState, memo } from 'react';
import PersistentWaveCanvas from './PersistentWaveCanvas';
import type { WaveChannelConfig } from './PersistentWaveCanvas';

// Fixed clinical ranges, mirroring the scale selector of a bedside ICU
// ventilator (Mindray SM/SV, Dräger Evita). The first entry is the default;
// the canvas exposes a button to cycle through the rest.
const CHANNELS: WaveChannelConfig[] = [
  {
    key: 'paw', color: '#f5c518', label: 'PRESIÓN', unit: 'cmH₂O',
    initialScale: 0,
    scales: [
      { min: 0, max: 40, step: 10 },   // rango adulto habitual
      { min: 0, max: 60, step: 20 },   // presiones altas / SDRA severo
      { min: 0, max: 80, step: 20 },   // obstrucción grave
    ],
  },
  {
    key: 'flow', color: '#3ddc84', label: 'FLUJO', unit: 'L/min',
    initialScale: 0,
    scales: [
      { min: -60,  max: 60,  step: 30 },
      { min: -120, max: 120, step: 60 },  // flujos pico altos
      { min: -30,  max: 30,  step: 15 },  // detalle de flujo espiratorio
    ],
  },
  {
    key: 'vol', color: '#22d3ee', label: 'VOLUMEN', unit: 'mL',
    initialScale: 0,
    scales: [
      { min: 0, max: 800,  step: 200 },
      { min: 0, max: 1500, step: 500 },
      { min: 0, max: 400,  step: 100 },  // VT bajo / ventilación protectora
    ],
  },
];

interface PersistentWavePanelProps {
  heights?: [number, number, number];
}

const PersistentWavePanel = memo(function PersistentWavePanel({
  heights,
}: PersistentWavePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [trackH, setTrackH] = useState(heights ? heights[0] : 88);

  useEffect(() => {
    if (heights) {
      setTrackH(heights[0]);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const h = Math.floor(entries[0].contentRect.height / 3);
      if (h > 0) setTrackH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [heights]);

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}
    >
      {CHANNELS.map((ch, i) => (
        <PersistentWaveCanvas
          key={ch.key}
          cfg={ch}
          height={heights ? heights[i] : trackH}
        />
      ))}
    </div>
  );
});

export { PersistentWavePanel };
export default PersistentWavePanel;
