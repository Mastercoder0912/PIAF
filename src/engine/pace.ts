import { METERS_PER_MILE } from "./distance";
import type { RaceTarget } from "./types";

/**
 * Pure pace math. All functions here assume ALREADY-VALIDATED numbers and
 * throw RangeError on nonsense input rather than returning Infinity/NaN.
 * User-facing checks live in validation.ts.
 *
 * Core identity (everything below is this one relationship):
 *
 *     time = distance * pace / METERS_PER_MILE
 *
 * No rounding anywhere; callers round only for display.
 */

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive, finite number (got ${value})`);
  }
}

/** Seconds per mile for covering `distanceMeters` in `totalTimeSeconds`. */
export function paceFromDistanceAndTime(distanceMeters: number, totalTimeSeconds: number): number {
  assertPositiveFinite("distanceMeters", distanceMeters);
  assertPositiveFinite("totalTimeSeconds", totalTimeSeconds);
  // Multiply before dividing: one division, so one rounding step.
  return (totalTimeSeconds * METERS_PER_MILE) / distanceMeters;
}

/**
 * Target time (seconds) at `distanceMeters` into a race run at a constant pace.
 * Distance 0 is allowed (the start line, time 0).
 */
export function targetTimeAtDistance(distanceMeters: number, paceSecondsPerMile: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError(`distanceMeters must be a non-negative, finite number (got ${distanceMeters})`);
  }
  assertPositiveFinite("paceSecondsPerMile", paceSecondsPerMile);
  return (distanceMeters * paceSecondsPerMile) / METERS_PER_MILE;
}

/** Total completion time: the target time at the finish line. */
export function completionTimeFromPace(totalDistanceMeters: number, paceSecondsPerMile: number): number {
  assertPositiveFinite("totalDistanceMeters", totalDistanceMeters);
  return targetTimeAtDistance(totalDistanceMeters, paceSecondsPerMile);
}

/**
 * Turn whichever goal the coach supplied into BOTH forms (time and pace).
 * Expects exactly one of the two to be set; run validateRaceConfig first.
 */
export function resolveRaceTarget(
  totalDistanceMeters: number,
  target: { targetTimeSeconds?: number | undefined; targetPaceSecondsPerMile?: number | undefined },
): RaceTarget {
  const { targetTimeSeconds, targetPaceSecondsPerMile } = target;
  const hasTime = targetTimeSeconds !== undefined && targetTimeSeconds !== null;
  const hasPace = targetPaceSecondsPerMile !== undefined && targetPaceSecondsPerMile !== null;
  if (hasTime === hasPace) {
    throw new RangeError("Provide exactly one of targetTimeSeconds or targetPaceSecondsPerMile");
  }

  if (hasPace) {
    return {
      paceSecondsPerMile: targetPaceSecondsPerMile,
      totalTimeSeconds: completionTimeFromPace(totalDistanceMeters, targetPaceSecondsPerMile),
    };
  }
  return {
    totalTimeSeconds: targetTimeSeconds as number,
    paceSecondsPerMile: paceFromDistanceAndTime(totalDistanceMeters, targetTimeSeconds as number),
  };
}
