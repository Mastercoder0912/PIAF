import type { CourseData, CoursePosition } from "./types";

/**
 * Where is the runner at a given distance? This one function is the single source of truth for the
 * course screen: the map marker, the profile cursor and the readouts are all derived from its result,
 * so they can't disagree. Between two recorded points everything is interpolated in a straight line.
 */

/** Keep a distance inside the course; anything that isn't a number counts as the start. */
export function clampDistance(course: Pick<CourseData, "distanceMeters">, meters: number): number {
  if (!Number.isFinite(meters)) return 0;
  return Math.min(Math.max(meters, 0), course.distanceMeters);
}

/** Index i of the last point at or before `meters`, limited to 0..n-2 so there is always a next point. */
function segmentIndex(course: CourseData, meters: number): number {
  const pts = course.points;
  let lo = 0;
  let hi = pts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid]![3] <= meters) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function positionAt(course: CourseData, meters: number): CoursePosition {
  const distance = clampDistance(course, meters);
  const i = segmentIndex(course, distance);
  const a = course.points[i]!;
  const b = course.points[i + 1]!;
  const span = b[3] - a[3];
  const t = span > 0 ? Math.min(Math.max((distance - a[3]) / span, 0), 1) : 0;
  return {
    distanceMeters: distance,
    lat: a[0] + (b[0] - a[0]) * t,
    lon: a[1] + (b[1] - a[1]) * t,
    elevationMeters: a[2] + (b[2] - a[2]) * t,
    inGap: course.gaps.some((g) => distance > g.startMeters && distance < g.endMeters),
  };
}
