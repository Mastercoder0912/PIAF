/**
 * Shared types for the Running Pacer calculation engine.
 *
 * Conventions used everywhere in the engine:
 *   - distances are METERS
 *   - times are SECONDS
 *   - pace is SECONDS PER MILE (1 mile = 1609.344 m)
 */

/** Units a user may type a distance in. Everything is converted to meters immediately. */
export type DistanceUnit = "m" | "km" | "mi";

export type IntervalMode = "automatic" | "manual";

export interface RaceConfig {
  totalDistanceMeters: number;
  /** Provide exactly one of targetTimeSeconds / targetPaceSecondsPerMile. */
  targetTimeSeconds?: number;
  targetPaceSecondsPerMile?: number;
  intervalMode: IntervalMode;
  /** Required (and only used) when intervalMode is "manual". */
  intervalDistanceMeters?: number;
}

export interface Split {
  id: string;
  distanceMeters: number;
  targetTimeSeconds: number;
  label: string;
  isFinish: boolean;
}

export interface PacingLocation {
  id: string;
  name: string;
  distanceMeters: number;
  targetTimeSeconds: number;
}

export type ValidationErrorCode =
  | "INVALID_DISTANCE"
  | "INVALID_DISTANCE_UNIT"
  | "INVALID_TIME"
  | "INVALID_TIME_FORMAT"
  | "INVALID_PACE"
  | "MISSING_TARGET"
  | "CONFLICTING_TARGETS"
  | "INVALID_INTERVAL_MODE"
  | "INVALID_INTERVAL"
  | "TOO_MANY_SPLITS"
  | "BEYOND_RACE_DISTANCE"
  | "DUPLICATE_DISTANCE"
  | "DUPLICATE_ID"
  | "INVALID_NAME";

export interface ValidationError {
  /** Stable, machine-readable code (use for logic and tests). */
  code: ValidationErrorCode;
  /** Which input the problem belongs to, e.g. "totalDistanceMeters" or "locations[2].distanceMeters". */
  field: string;
  /** Plain-English explanation that can be shown to a coach as-is. */
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

/** The two equivalent ways of describing a goal, both resolved. */
export interface RaceTarget {
  totalTimeSeconds: number;
  paceSecondsPerMile: number;
}

export interface RaceCalculation extends RaceTarget {
  totalDistanceMeters: number;
  /** Ascending by distance; the last entry is always the finish line. */
  splits: Split[];
}
