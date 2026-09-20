// src/utils/clinicalDayPartition.ts
//
// Partition lab orders by clinical day (Day 1, 2, 3…) relative to scenario start.
// Both inputs are useTimeStore.simulatedElapsed (sim-seconds) — NOT ticks
// (C1.9: ticks advances at a fixed 240/real-second regardless of
// speedMultiplier; it is never a proxy for simulated seconds. Previously
// this function mixed readyAt, already in simulatedElapsed via LabEngine,
// against scenarioStartTick, which was raw ticks — comparing two different
// clocks silently).

import type { LabOrder } from '../store/usePatientStore';

/** Returns clinical day number (1-based) for a given simulatedElapsed instant */
export function clinicalDayOf(atSimS: number, scenarioStartSimS: number): number {
  const elapsed_s = atSimS - scenarioStartSimS;
  return Math.max(1, Math.floor(elapsed_s / (24 * 3600)) + 1);
}

/**
 * Groups lab orders by clinical day.
 * Uses readyAt (result available, in simulatedElapsed) as the day reference.
 */
export function partitionLabsByDay(
  orders: LabOrder[],
  scenarioStartSimS: number,
): Map<number, LabOrder[]> {
  const byDay = new Map<number, LabOrder[]>();
  orders.forEach(o => {
    const day = clinicalDayOf(o.readyAt, scenarioStartSimS);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(o);
  });
  return byDay;
}

/** Sort days descending (newest first) */
export function sortedDaysDesc(map: Map<number, unknown[]>): number[] {
  return Array.from(map.keys()).sort((a, b) => b - a);
}
