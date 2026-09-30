// src/components/ventilator/VentilatorLoops.tsx
//
// Bucles ventilatorios: presion-volumen y flujo-volumen.
//
// Las curvas contra el tiempo dicen QUE pasa; los bucles dicen POR QUE. Son la
// herramienta de cabecera para leer mecanica respiratoria:
//
//   P-V  — la pendiente es la compliance. Un aplanamiento en la parte alta
//          (el "pico de pajaro") indica sobredistension y pide bajar el VT;
//          un codo en la parte baja marca el punto de apertura alveolar y
//          orienta el PEEP. El area encerrada es el trabajo respiratorio, y
//          su anchura, la resistencia.
//   F-V  — la rama espiratoria excavada delata obstruccion (EPOC, asma); que
//          no vuelva al origen es atrapamiento aereo o fuga.
//
// Se dibuja el ultimo ciclo completo, no una ventana movil: un bucle solo
// significa algo si empieza y acaba en el mismo sitio del ciclo respiratorio.
/* eslint-disable react/forbid-dom-props */

import React, { useEffect, useRef, useCallback, memo } from 'react';
import { RespiratoryEngine } from '../../core/RespiratoryEngine';
import { useTimeStore }      from '../../store/useTimeStore';
import { usePatientStore }   from '../../store/usePatientStore';
import { samplesInRange }    from '../../utils/waveInterpolation';

export type LoopKind = 'pv' | 'fv';

const BG = '#0a0a10';
/** Refresco del bucle: uno por respiracion basta, y a mas se ve parpadeo. */
const REDRAW_MS = 250;

interface LoopConfig {
  kind:   LoopKind;
  title:  string;
  xLabel: string;
  yLabel: string;
  color:  string;
}

const CONFIG: Record<LoopKind, LoopConfig> = {
  pv: { kind: 'pv', title: 'BUCLE P–V', xLabel: 'Volumen (mL)', yLabel: 'Presión (cmH₂O)', color: '#f5c518' },
  fv: { kind: 'fv', title: 'BUCLE F–V', xLabel: 'Volumen (mL)', yLabel: 'Flujo (L/min)',   color: '#3ddc84' },
};

interface Props {
  kind:    LoopKind;
  width?:  number;
  height?: number;
}

const VentilatorLoops = memo(function VentilatorLoops({ kind, width = 230, height = 190 }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const lastPaint  = useRef<number>(0);
  const cfg = CONFIG[kind];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)   { rafRef.current = requestAnimationFrame(draw); return; }

    const now = performance.now();
    if (now - lastPaint.current < REDRAW_MS) {
      rafRef.current = requestAnimationFrame(draw); return;
    }
    lastPaint.current = now;

    const W = canvas.width, H = canvas.height;
    const PAD_L = 34, PAD_B = 22, PAD_T = 16, PAD_R = 8;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const engine = RespiratoryEngine.getInstance().getVentEngine();
    const connected = usePatientStore.getState().isVentilatorConnected;

    const msg = (text: string) => {
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, H / 2);
      rafRef.current = requestAnimationFrame(draw);
    };

    if (!connected)                   { msg('SIN VENTILACIÓN'); return; }
    if (!useTimeStore.getState().isRunning) { msg('PAUSADO');   return; }

    const breath = engine.getLastBreath();
    if (breath.breathId < 1 || breath.tCycle < 0.1) { msg('ESPERANDO CICLO'); return; }

    // Ultimo ciclo COMPLETO. Pedir sin mas una ventana de un tCycle no sirve:
    // su borde cae en un punto arbitrario de la respiracion y el trazo une dos
    // medios ciclos, con lo que el bucle no cierra y deja de significar nada.
    //
    // El inicio real de la inspiracion es donde el volumen toca su minimo, asi
    // que se piden algo mas de dos ciclos y se recorta entre los dos ultimos
    // minimos: eso es exactamente una respiracion, empiece donde empiece la
    // ventana.
    const tNow = engine.getWaveCursorTime();
    const wf = engine.getWaveforms();
    const raw = samplesInRange(wf, tNow - breath.tCycle * 2.4, tNow);
    if (raw.length < 16) { msg('ESPERANDO CICLO'); return; }

    const cycleStarts: number[] = [];
    for (let i = 1; i < raw.length; i++) {
      // El inicio de la inspiracion es donde el flujo cruza de espiratorio
      // (negativo) a inspiratorio (positivo). Buscar minimos de volumen no
      // sirve: durante la pausa espiratoria el volumen queda plano y el valle
      // se detecta en cualquier punto de esa meseta, con lo que el recorte se
      // quedaba solo con la rama inspiratoria.
      if (raw[i - 1].flow <= 0 && raw[i].flow > 0) {
        if (cycleStarts.length === 0 || i - cycleStarts[cycleStarts.length - 1] > 4) cycleStarts.push(i);
      }
    }
    const s = cycleStarts.length >= 2
      ? raw.slice(cycleStarts[cycleStarts.length - 2], cycleStarts[cycleStarts.length - 1] + 1)
      : raw;
    if (s.length < 8) { msg('ESPERANDO CICLO'); return; }

    // ── Escalas: del propio ciclo, con margen ──────────────────────────────
    const xs = s.map(p => p.vol);
    const ys = s.map(p => (kind === 'pv' ? p.paw : p.flow));
    const xMin = 0;
    const xMax = Math.max(50, Math.max(...xs) * 1.1);
    let yMin = Math.min(0, Math.min(...ys));
    let yMax = Math.max(...ys);
    const pad = Math.max(1, (yMax - yMin) * 0.1);
    yMin -= pad; yMax += pad;
    if (yMax - yMin < 1) yMax = yMin + 1;

    const toX = (v: number) => PAD_L + ((v - xMin) / (xMax - xMin)) * plotW;
    const toY = (v: number) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // ── Ejes y rejilla ─────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, PAD_T + plotH);
    ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
    ctx.stroke();

    ctx.font = '7px JetBrains Mono, monospace';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 2; i++) {
      const v = yMin + ((yMax - yMin) * i) / 2;
      const y = toY(v);
      ctx.fillText(v.toFixed(0), PAD_L - 4, y);
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + plotW, y); ctx.stroke();
      }
    }
    // Linea de cero en F-V: separa inspiracion de espiracion.
    if (kind === 'fv' && yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      const y0 = toY(0);
      ctx.beginPath(); ctx.moveTo(PAD_L, y0); ctx.lineTo(PAD_L + plotW, y0); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(xMax.toFixed(0), PAD_L + plotW, PAD_T + plotH + 10);
    ctx.fillText('0', PAD_L, PAD_T + plotH + 10);

    // ── Trazo del bucle ────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD_L, PAD_T, plotW, plotH); ctx.clip();
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.shadowColor = cfg.color;
    ctx.shadowBlur = 3;
    ctx.beginPath();
    s.forEach((p, i) => {
      const x = toX(p.vol);
      const y = toY(kind === 'pv' ? p.paw : p.flow);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Punto de inicio del ciclo: ancla visual para ver si el bucle cierra.
    // En F-V, que no vuelva al origen es atrapamiento aereo o fuga.
    const p0 = s[0];
    ctx.fillStyle = cfg.color;
    ctx.beginPath();
    ctx.arc(toX(p0.vol), toY(kind === 'pv' ? p0.paw : p0.flow), 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Titulo y ejes ──────────────────────────────────────────────────────
    ctx.fillStyle = cfg.color;
    ctx.font = 'bold 8px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(cfg.title, PAD_L, 10);

    ctx.fillStyle = '#475569';
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(cfg.xLabel, W - PAD_R, H - 4);
    ctx.save();
    ctx.translate(8, PAD_T + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(cfg.yLabel, 0, 0);
    ctx.restore();

    rafRef.current = requestAnimationFrame(draw);
  }, [kind, cfg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, width, height]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`${cfg.title} — ${cfg.yLabel} frente a ${cfg.xLabel}`}
      style={{
        display: 'block', borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.07)', background: BG,
      }}
    />
  );
});

export { VentilatorLoops };
export default VentilatorLoops;
