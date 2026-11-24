import { formatDuration, fromMeters, type DistanceUnit } from "./engine";

/**
 * Display-only helpers. Times are shown to the nearest tenth of a second;
 * the engine's underlying numbers are never rounded or modified.
 */

export function formatTenths(seconds: number): string {
  return formatDuration(seconds, 1);
}

/** Round for display only: up to `maxDecimals`, trailing zeros dropped, never locale-dependent. */
function trimmed(value: number, maxDecimals: number): string {
  return Number(value.toFixed(maxDecimals)).toString();
}

/** "1200 m", "1.5 m", "333.33 m" */
export function formatMeters(meters: number): string {
  return `${trimmed(meters, 2)} m`;
}

/** A distance in the unit the coach entered it in: "800 m", "1.2 km", "2 mi". */
export function formatDistanceInUnit(meters: number, unit: DistanceUnit): string {
  switch (unit) {
    case "m":
      return formatMeters(meters);
    case "km":
      return `${trimmed(fromMeters(meters, "km"), 3)} km`;
    case "mi":
      return `${trimmed(fromMeters(meters, "mi"), 3)} mi`;
  }
}
