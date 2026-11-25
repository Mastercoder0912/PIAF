import { METERS_PER_MILE } from "../engine";
import type { CourseGap } from "./types";

/**
 * Display text for courses: miles and feet first (what coaches here use), metric alongside.
 * Display-only rounding; the data is never changed.
 */

export const FEET_PER_METER = 3.280839895;

export const metersToMiles = (meters: number) => meters / METERS_PER_MILE;
export const metersToFeet = (meters: number) => meters * FEET_PER_METER;

/** "1.25 mi" */
export const formatMiles = (meters: number) => `${metersToMiles(meters).toFixed(2)} mi`;

/** "1.25 mi (2.01 km)" */
export const formatDistance = (meters: number) => `${formatMiles(meters)} (${(meters / 1000).toFixed(2)} km)`;

/** "669 ft (203.8 m)" */
export const formatElevation = (meters: number) => `${Math.round(metersToFeet(meters))} ft (${meters.toFixed(1)} m)`;

/** "251 ft (77 m)", for climbing and descending totals */
export const formatClimb = (meters: number) => `${Math.round(metersToFeet(meters))} ft (${Math.round(meters)} m)`;

/** What the coach is told about a stretch with no recorded points. */
export function describeGap(gap: CourseGap): string {
  const length = Math.round(gap.endMeters - gap.startMeters);
  const when = gap.seconds === null ? "" : ` (about ${Math.round(gap.seconds)} seconds)`;
  return `Nothing was recorded for ${length} m${when} between mile ${metersToMiles(gap.startMeters).toFixed(2)} and mile ${metersToMiles(gap.endMeters).toFixed(2)}, so the route there is a dashed straight line and the elevation change is a single step.`;
}

/** The date a run was recorded, as text that doesn't depend on the viewer's locale or time zone. */
export function formatRecordedDate(iso: string | null): string | null {
  const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  if (!match) return null;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : null;
}
