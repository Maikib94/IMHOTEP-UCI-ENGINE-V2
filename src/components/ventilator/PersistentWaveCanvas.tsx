// src/components/ventilator/PersistentWaveCanvas.tsx
// Canonical sweep-oscilloscope renderer for a single ARM waveform channel.
// Uses an offscreen canvas for persistence — the visible canvas only adds
// the cursor line. This prevents the large-erase-band flicker at x60 speed.
//
// Time model (FASE 5): wf.t[] stores simTime. xCursor = (simT × pxPerSimSec) % PLOT_W.
// At any speed, the oscilloscope window shows the last WINDOW_SIM_S sim-seconds.
//
// Scale model: FIXED clinical ranges, selectable per channel — the way a real
// ICU ventilator works. Autoscale was removed: the persistence canvas holds up
// to WINDOW_SIM_S of trace, so a mid-window range change left older pixels drawn
// at the previous scale and the visible curve mixed two different scales.
//
// Refs:
//   Mojoli F et al., Critical Care 2018;22:262 — waveform analysis for async detection.
//   IEC 60601-2-12 — min 4 Hz refresh for respiratory waveforms on ICU monitors.
/* eslint-disable react/forbid-dom-props */

import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import { RespiratoryEngine } from '../../core/RespiratoryEngine';
import { useTimeStore }      from '../../store/useTimeStore';
import { usePatientStore }   from '../../store/usePatientStore';
import { samplesInRange } from '../../utils/waveInterpolation';

export type WaveChannel = 'paw' | 'flow' | 'vol';

/** A selectable fixed range, as printed on a real ventilator's scale selector. */
export interface WaveScale {
  min:  number;
  max:  number;
  step: number;   // gridline / label interval
}

export interface WaveChannelConfig {
  key:     WaveChannel;
  color:   string;
  label:   string;
  unit:    string;
  scales:  WaveScale[];
  initialScale: number;   // index into scales[]
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Sweep window. Bedside ventilators run ~10–12 s per screen so two to four
// breaths are visible at once — a single breath per screen makes it impossible
// to compare consecutive cycles or spot an asynchrony.
const WINDOW_SIM_S = 10;
const TIME_TICK_S  = 1;    // vertical gridline interval (s)
const BG_COLOR     = '#0a0a10';
const ERASE_AHEAD  = 10;   // px — blank band ahead of cursor on offscreen
const PAD_L        = 36;   // px — left gutter reserved for the Y axis labels
const AXIS_FONT    = '8px JetBrains Mono, ui-monospace, monospace';

const FRAME_LIMITS: [number, number][] = [
  [60, 1000 / 20],
  [30, 1000 / 20],
  [10, 1000 / 30],
  [2,  1000 / 45],
  [1,  1000 / 60],
];

function minFrameMs(speed: number): number {
  for (const [threshold, ms] of FRAME_LIMITS) {
    if (speed >= threshold) return ms;
  }
  return 1000 / 60;
}

function makeOffscreen(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const el = document.createElement('canvas');
  el.width = w; el.height = h;
  return el;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function get2d(c: OffscreenCanvas | HTMLCanvasElement): Ctx2D | null {
  return c.getContext('2d') as CanvasRenderingContext2D | null;
}

/** Gridline values for a scale, always including min and max. */
function gridValues(sc: WaveScale): number[] {
  const out: number[] = [];
  for (let v = sc.min; v <= sc.max + 1e-6; v += sc.step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] !== sc.max) out.push(sc.max);
  return out;
}

// ─── Single channel ───────────────────────────────────────────────────────────

interface ChannelProps {
  cfg:     WaveChannelConfig;
  height?: number;
}

const PersistentWaveCanvas = memo(function PersistentWaveCanvas({
  cfg, height = 100,
}: ChannelProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const offRef       = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const rafRef       = useRef<number>(0);
  const lastPaintMs  = useRef<number>(0);
  const lastSimTRef  = useRef<number>(-1);
  const lastXRef     = useRef<number>(0);
  // Last plotted point. The sweep advances ~1.6 samples per frame at x1
  // (100 Hz buffer, 60 fps), so a frame often carries a single sample and
  // would draw nothing on its own — the trace came out dotted. Chaining each
  // frame to the previous frame's endpoint keeps the stroke continuous.
  const lastPtRef    = useRef<{ x: number; y: number } | null>(null);

  const [scaleIdx, setScaleIdx] = useState(cfg.initialScale);
  // draw() runs inside RAF and must see the current scale without being
  // rebuilt (a new draw identity would restart the effect and wipe the trace).
  const scaleRef = useRef<WaveScale>(cfg.scales[cfg.initialScale]);
  scaleRef.current = cfg.scales[scaleIdx];

  // Changing the scale invalidates every pixel already on the persistence
  // canvas — they were plotted against the old range.
  const cycleScale = useCallback(() => {
    setScaleIdx(i => (i + 1) % cfg.scales.length);
    lastSimTRef.current = -1;
    lastPtRef.current   = null;
  }, [cfg.scales.length]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)  { rafRef.current = requestAnimationFrame(draw); return; }

    const W = canvas.width;
    const H = canvas.height;
    if (W < PAD_L + 8) { rafRef.current = requestAnimationFrame(draw); return; }

    const PLOT_W = W - PAD_L;
    const sc     = scaleRef.current;
    const yRange = sc.max - sc.min || 1;

    // Plot-area mapping. No clamping: an out-of-range excursion must leave the
    // band the way it does on a real ventilator, not flatten into a fake
    // plateau against the border. The clip region below hides the overflow.
    const toY = (v: number) => H - 2 - ((v - sc.min) / yRange) * (H - 4);
    const toX = (t: number) => PAD_L + (((t * (PLOT_W / WINDOW_SIM_S)) % PLOT_W) + PLOT_W) % PLOT_W;

    /** Gridlines + zero emphasis, restricted to an x-band of the offscreen. */
    const paintGrid = (c: Ctx2D, x0: number, w: number) => {
      if (w <= 0) return;
      c.save();
      c.beginPath(); c.rect(x0, 0, w, H); c.clip();
      c.lineWidth = 1;
      for (const v of gridValues(sc)) {
        const y = Math.round(toY(v)) + 0.5;
        const isZero = v === 0 && sc.min < 0 && sc.max > 0;
        c.strokeStyle = isZero ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
        if (!isZero) c.setLineDash([2, 4]);
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke();
        c.setLineDash([]);
      }
      // Time ticks — fixed positions, since the sweep is modular in x.
      const pxPerSec = PLOT_W / WINDOW_SIM_S;
      c.strokeStyle = 'rgba(255,255,255,0.05)';
      for (let k = 1; k * TIME_TICK_S < WINDOW_SIM_S; k++) {
        const x = Math.round(PAD_L + k * TIME_TICK_S * pxPerSec) + 0.5;
        if (x < x0 || x > x0 + w) continue;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      }
      c.restore();
    };

    const now   = performance.now();
    const speed = useTimeStore.getState().speedMultiplier;

    if (now - lastPaintMs.current < minFrameMs(speed)) {
      rafRef.current = requestAnimationFrame(draw); return;
    }
    lastPaintMs.current = now;

    // ── Ensure offscreen canvas exists and matches dimensions ─────────────────
    if (!offRef.current || offRef.current.width !== W || offRef.current.height !== H) {
      offRef.current = makeOffscreen(W, H);
      const c0 = get2d(offRef.current);
      if (c0) { c0.fillStyle = BG_COLOR; c0.fillRect(0, 0, W, H); paintGrid(c0, PAD_L, PLOT_W); }
      lastSimTRef.current = -1;
      lastXRef.current    = PAD_L;
      lastPtRef.current   = null;
    }

    const ctxOff = get2d(offRef.current!);
    if (!ctxOff) { rafRef.current = requestAnimationFrame(draw); return; }

    /** Y axis + numeric labels, painted on the visible canvas above the trace. */
    const paintAxis = () => {
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, PAD_L, H);
      ctx.font = AXIS_FONT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of gridValues(sc)) {
        const y = toY(v);
        if (y < 5 || y > H - 3) continue;
        ctx.fillStyle = v === 0 && sc.min < 0 ? '#94a3b8' : '#5a5a7a';
        ctx.fillText(String(v), PAD_L - 5, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L + 0.5, 0); ctx.lineTo(PAD_L + 0.5, H); ctx.stroke();
    };

    // ── Gate: ventilator connected ─────────────────────────────────────────────
    if (!usePatientStore.getState().isVentilatorConnected) {
      ctxOff.fillStyle = BG_COLOR; ctxOff.fillRect(0, 0, W, H);
      paintGrid(ctxOff, PAD_L, PLOT_W);
      ctx.drawImage(offRef.current!, 0, 0);
      paintAxis();
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('INICIANDO VENTILACIÓN…', PAD_L + PLOT_W / 2, H / 2);
      lastSimTRef.current = -1;
      lastPtRef.current   = null;
      rafRef.current = requestAnimationFrame(draw); return;
    }

    // ── Gate: paused ──────────────────────────────────────────────────────────
    if (!useTimeStore.getState().isRunning) {
      ctx.drawImage(offRef.current!, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      paintAxis();
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('SIMULACIÓN PAUSADA', PAD_L + PLOT_W / 2, H / 2);
      rafRef.current = requestAnimationFrame(draw); return;
    }

    const engine = RespiratoryEngine.getInstance().getVentEngine();
    const simT   = engine.getWaveCursorTime();   // = simTime (FASE 5 fix)

    if (engine.getWaveforms().length < 4) {
      ctx.fillStyle = BG_COLOR; ctx.fillRect(0, 0, W, H);
      paintAxis();
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('INICIANDO…', PAD_L + PLOT_W / 2, H / 2);
      lastSimTRef.current = -1;
      lastPtRef.current   = null;
      rafRef.current = requestAnimationFrame(draw); return;
    }

    const xNow = Math.floor(toX(simT));

    // ── First frame or reset ──────────────────────────────────────────────────
    if (lastSimTRef.current < 0 || simT < lastSimTRef.current || simT - lastSimTRef.current > WINDOW_SIM_S) {
      ctxOff.fillStyle = BG_COLOR; ctxOff.fillRect(0, 0, W, H);
      paintGrid(ctxOff, PAD_L, PLOT_W);
      lastSimTRef.current = simT;
      lastXRef.current    = xNow;
      lastPtRef.current   = null;
      rafRef.current = requestAnimationFrame(draw); return;
    }

    const prevSimT = lastSimTRef.current;
    const prevX    = lastXRef.current;

    // ── Sweep band delta ──────────────────────────────────────────────────────
    let dxRaw = xNow - prevX;
    if (dxRaw < 0) dxRaw += PLOT_W;
    const dx = Math.min(dxRaw, PLOT_W - 1);

    // No pixel advance this frame (sub-pixel step): composite and reschedule
    if (dxRaw === 0) {
      ctx.drawImage(offRef.current!, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xNow, 0); ctx.lineTo(xNow, H); ctx.stroke();
      paintAxis();
      rafRef.current = requestAnimationFrame(draw); return;
    }

    // ── Erase future band on offscreen, then restore the grid under it ────────
    ctxOff.fillStyle = BG_COLOR;
    if (xNow > prevX) {
      const w = Math.min(dx + ERASE_AHEAD, W - prevX);
      ctxOff.fillRect(prevX, 0, w, H);
      paintGrid(ctxOff, prevX, w);
    } else {
      // wraparound
      ctxOff.fillRect(prevX, 0, W - prevX, H);
      paintGrid(ctxOff, prevX, W - prevX);
      const w2 = Math.min(xNow + ERASE_AHEAD, W) - PAD_L;
      ctxOff.fillRect(PAD_L, 0, w2, H);
      paintGrid(ctxOff, PAD_L, w2);
    }

    // ── Draw samples on offscreen, clipped to the plot area ───────────────────
    const wf      = engine.getWaveforms();
    const samples = samplesInRange(wf, prevSimT, simT);

    if (samples.length >= 1) {
      ctxOff.save();
      ctxOff.beginPath(); ctxOff.rect(PAD_L, 0, PLOT_W, H); ctxOff.clip();
      ctxOff.strokeStyle = cfg.color;
      ctxOff.lineWidth   = 1.8;
      ctxOff.lineJoin    = 'round';
      ctxOff.lineCap     = 'round';
      ctxOff.shadowColor = cfg.color;
      ctxOff.shadowBlur  = 4;
      ctxOff.beginPath();

      // Start from the previous frame's endpoint so consecutive frames join.
      let moved  = false;
      let prevSx = 0;
      const seed = lastPtRef.current;
      if (seed) { ctxOff.moveTo(seed.x, seed.y); moved = true; prevSx = seed.x; }

      for (let i = 0; i < samples.length; i++) {
        const s  = samples[i];
        const sx = toX(s.t);
        const sy = toY(s[cfg.key] as number);
        // A backwards jump in x means the sweep wrapped between two samples:
        // break the stroke instead of dragging a line back across the canvas.
        if (moved && sx < prevSx - PLOT_W / 2) {
          ctxOff.stroke();
          ctxOff.beginPath();
          moved = false;
        }
        if (!moved) { ctxOff.moveTo(sx, sy); moved = true; }
        else ctxOff.lineTo(sx, sy);
        prevSx = sx;
        if (i === samples.length - 1) lastPtRef.current = { x: sx, y: sy };
      }
      ctxOff.stroke();
      ctxOff.shadowBlur = 0;
      ctxOff.restore();
    }

    // ── Composite offscreen → visible ─────────────────────────────────────────
    ctx.drawImage(offRef.current!, 0, 0);

    // ── Cursor line on visible (not accumulated) ──────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(xNow, 0);
    ctx.lineTo(xNow, H);
    ctx.stroke();

    paintAxis();

    // ── Speed badge at high velocity ─────────────────────────────────────────
    if (speed >= 10) {
      ctx.fillStyle = 'rgba(251,146,60,0.85)';
      ctx.font      = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${speed}×`, W - 6, 12);
    }

    lastSimTRef.current = simT;
    lastXRef.current    = xNow;
    rafRef.current = requestAnimationFrame(draw);
  }, [cfg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.fillStyle = BG_COLOR; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0 && w !== canvas.width) {
        canvas.width  = w;
        canvas.height = height;
        // offscreen will be recreated in draw() on next frame
        offRef.current   = null;
        lastSimTRef.current = -1;
        lastXRef.current    = PAD_L;
        lastPtRef.current   = null;
      }
    });
    ro.observe(canvas.parentElement ?? canvas);
    rafRef.current = requestAnimationFrame(draw);
    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, [draw, height]);

  const sc = cfg.scales[scaleIdx];

  return (
    <div style={{ position: 'relative', width: '100%', height, borderBottom: '1px solid #1a1a28' }}>
      <div style={{
        position: 'absolute', top: 4, left: PAD_L + 6, zIndex: 1,
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
        color: cfg.color,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        textShadow: `0 0 12px ${cfg.color}88`,
        pointerEvents: 'none',
      }}>
        {cfg.label}
        <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 4, color: '#5a5a7a' }}>
          {cfg.unit}
        </span>
      </div>

      {/* Scale selector — a real ventilator lets you pick the range, not autoscale */}
      {cfg.scales.length > 1 && (
        <button
          type="button"
          onClick={cycleScale}
          title={`Escala ${cfg.label}: ${sc.min} a ${sc.max} ${cfg.unit} — pulse para cambiar`}
          style={{
            position: 'absolute', top: 3, right: 4, zIndex: 2,
            padding: '1px 5px', borderRadius: 4, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: '#64748b', fontSize: 8, fontWeight: 700,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          }}
        >
          {sc.min}–{sc.max}
        </button>
      )}

      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        aria-label={`${cfg.label} waveform, escala ${sc.min} a ${sc.max} ${cfg.unit}`}
      />
    </div>
  );
});

export { PersistentWaveCanvas };
export default PersistentWaveCanvas;
