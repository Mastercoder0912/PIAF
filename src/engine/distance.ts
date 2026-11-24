import type { DistanceUnit } from "./types";

/** Exact definition of the international statute mile. */
export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KILOMETER = 1000;

/**
 * Two distances closer than this are treated as the same point on the course.
 *
 * Why 1 micrometer: double-precision error on a value like 3 * 1609.344 is on
 * the order of 1e-12 m, so 1e-6 m comfortably absorbs floating-point noise
 * while being far below anything a human could measure on a course.
 */
export const DISTANCE_TOLERANCE_METERS = 1e-6;

export const DISTANCE_UNITS: readonly DistanceUnit[] = ["m", "km", "mi"];

const METERS_PER_UNIT: Record<DistanceUnit, number> = {
  m: 1,
  km: METERS_PER_KILOMETER,
  mi: METERS_PER_MILE,
};

/** Type guard for values arriving from forms, JSON, or JS callers. */
export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return typeof value === "string" && (DISTANCE_UNITS as readonly string[]).includes(value);
}

function metersPerUnit(unit: DistanceUnit): number {
  if (!isDistanceUnit(unit)) {
    throw new RangeError(`Unsupported distance unit: ${String(unit)}`);
  }
  return METERS_PER_UNIT[unit];
}

/** Convert a value in `unit` to meters. No rounding. */
export function toMeters(value: number, unit: DistanceUnit): number {
  return value * metersPerUnit(unit);
}

/** Convert meters to `unit`. No rounding. */
export function fromMeters(meters: number, unit: DistanceUnit): number {
  return meters / metersPerUnit(unit);
}

/** Convert between any two supported units, going through meters. */
export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  return fromMeters(toMeters(value, from), to);
}

/** True when two distances are the same point (within DISTANCE_TOLERANCE_METERS). */
export function distancesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= DISTANCE_TOLERANCE_METERS;
}

/** Display-only: "200 m", "1 mile", "2 miles", "1.5 m". Never used in calculations. */
export function formatDistanceLabel(meters: number): string {
  const nearestWholeMile = Math.round(meters / METERS_PER_MILE);
  if (nearestWholeMile >= 1 && distancesEqual(meters, nearestWholeMile * METERS_PER_MILE)) {
    return nearestWholeMile === 1 ? "1 mile" : `${nearestWholeMile} miles`;
  }
  // Max 2 decimals, trailing zeros dropped. Locale-independent on purpose.
  return `${Number(meters.toFixed(2))} m`;
}
