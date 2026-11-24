/**
 * Ahead / behind / on-target comparison between a target and an actual passing time.
 *
 *   difference = actual - target
 *   negative  -> ahead (faster than target)
 *   positive  -> behind (slower than target)
 *   |difference| <= tolerance -> on target
 *
 * The tolerance is inclusive: exactly 1.00 s late is still "on target"; 1.01 s is behind.
 * Values are never rounded for the decision, except to remove floating-point noise
 * (about 1e-13 s) so that e.g. 301.00000000000006 - 300 doesn't count as behind.
 */

export const ON_TARGET_TOLERANCE_SECONDS = 1;

export type PassingStatus = "ahead" | "on-target" | "behind";

export interface PassingComparison {
  /** actual - target, in seconds. Negative = ahead. Full precision (microsecond-snapped). */
  differenceSeconds: number;
  status: PassingStatus;
}

/** Snap to whole microseconds: removes binary floating-point noise, far below any real timing resolution. */
export function snapMicros(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

export function comparePassingTime(
  targetSeconds: number,
  actualSeconds: number,
  toleranceSeconds: number = ON_TARGET_TOLERANCE_SECONDS,
): PassingComparison {
  if (!Number.isFinite(targetSeconds) || !Number.isFinite(actualSeconds)) {
    throw new RangeError("Target and actual times must be finite numbers.");
  }
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new RangeError("Tolerance must be a finite number of seconds, 0 or more.");
  }
  const differenceSeconds = snapMicros(actualSeconds - targetSeconds);
  const status: PassingStatus =
    Math.abs(differenceSeconds) <= snapMicros(toleranceSeconds)
      ? "on-target"
      : differenceSeconds < 0
        ? "ahead"
        : "behind";
  return { differenceSeconds, status };
}

/** Upper-case label shown next to the number so status never depends on color. */
export const STATUS_LABEL: Record<PassingStatus, string> = {
  ahead: "AHEAD",
  "on-target": "ON TARGET",
  behind: "BEHIND",
};
