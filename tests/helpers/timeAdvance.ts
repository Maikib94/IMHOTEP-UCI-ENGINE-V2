// tests/helpers/timeAdvance.ts
// Advance simulated time and step engines synchronously (no rAF needed).

import { useTimeStore }          from '../../src/store/useTimeStore';
import { RespiratoryEngine }     from '../../src/core/RespiratoryEngine';
import { CardiovascularEngine }  from '../../src/core/CardiovascularEngine';
import { PharmacologyEngine }    from '../../src/core/PharmacologyEngine';
import { RenalEngine }           from '../../src/core/RenalEngine';
import { PathologyEngine }       from '../../src/core/PathologyEngine';
import { CrosstalkEngine }       from '../../src/core/CrosstalkEngine';
import { AcidBaseEngine }        from '../../src/core/AcidBaseEngine';
import { AcuteMortalityEngine }  from '../../src/core/AcuteMortalityEngine';

/**
 * Advance simulation by `seconds` sim-seconds in steps of `dt`.
 * Calls each engine in clinical order without requestAnimationFrame.
 */
export function advanceSimSeconds(seconds: number, dt = 0.5): void {
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) stepEngines(dt);
}

/** One tick across every engine, in clinical order. */
function stepEngines(dt: number): void {
  useTimeStore.getState().advanceTick(dt);
  PathologyEngine.getInstance().update(dt);
  PharmacologyEngine.getInstance().update(dt);
  RenalEngine.getInstance().update(dt);
  RespiratoryEngine.getInstance().update(dt);
  CardiovascularEngine.getInstance().updateHemodynamics(dt);
  AcidBaseEngine.getInstance().update(dt);
  CrosstalkEngine.getInstance().update(dt);
  AcuteMortalityEngine.getInstance().update(dt);
}

/**
 * Same stepping as advanceSimSeconds, but yields to the event loop every
 * `yieldEveryMs` of wall time.
 *
 * Vitest's worker RPC has a hard 60 s call timeout (birpc DEFAULT_TIMEOUT —
 * not configurable through vitest.config). A test that blocks the thread past
 * that makes `onTaskUpdate` time out, which vitest reports as an unhandled
 * error and counts against the run even though every assertion passed. Yielding
 * lets the RPC drain; it does not change the physics, the order or the dt.
 */
export async function advanceSimSecondsAsync(
  seconds: number, dt = 0.5, yieldEveryMs = 2000,
): Promise<void> {
  const steps = Math.max(1, Math.round(seconds / dt));
  let lastYield = Date.now();
  for (let i = 0; i < steps; i++) {
    stepEngines(dt);
    // Mask keeps the clock read off the hot path (~16k ticks between checks).
    if ((i & 0x3fff) === 0 && Date.now() - lastYield >= yieldEveryMs) {
      await new Promise(resolve => setImmediate(resolve));
      lastYield = Date.now();
    }
  }
}

/**
 * Advance with a specific speed multiplier active.
 */
export function advanceWithSpeed(seconds: number, speed: number, dt = 0.5): void {
  useTimeStore.getState().setSpeed(speed);
  advanceSimSeconds(seconds * speed, dt * speed);
  useTimeStore.getState().setSpeed(1);
}
