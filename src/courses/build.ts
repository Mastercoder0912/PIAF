import { gainAndLoss, GAIN_METHOD } from "./elevation.ts";
import { stepMeters } from "./geo.ts";
import { GpxError, parseGpx } from "./gpx.ts";
import type { CourseData, CourseGap, CourseMeta, CoursePoint } from "./types.ts";

/**
 * Turns a GPX file into course data. Used by the build script (scripts/build-courses.ts) and by the tests
 * that prove the committed data matches its GPX. (Imports end in .ts because Node runs this file directly.)
 *
 * What is kept: every track point, unchanged except rounding for size (coordinates 6 decimals = 0.11 m,
 * elevation and distance 0.1 m). What is flagged, not changed: any stretch where nothing was recorded.
 */

/** Nominal recording is one point per second. A longer silence means the watch paused or lost GPS. */
export const GAP_SECONDS = 10;

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

export function buildCourse(meta: CourseMeta, gpxText: string, sha256: string): CourseData {
  const gpx = parseGpx(gpxText);
  if (gpx.points.length < 2) {
    throw new GpxError("too_few_points", "A course needs at least two track points.");
  }
  const missing = gpx.points.filter((p) => p.ele === null).length;
  if (missing > 0) {
    throw new GpxError(
      "missing_elevation",
      `${missing} of ${gpx.points.length} track points have no elevation. An elevation profile can't be built without it, and elevation is never guessed.`,
    );
  }

  const exact: number[] = [0];
  const gaps: CourseGap[] = [];
  for (let i = 1; i < gpx.points.length; i++) {
    const a = gpx.points[i - 1]!;
    const b = gpx.points[i]!;
    const start = exact[i - 1]!;
    const end = start + stepMeters(a.lat, a.lon, b.lat, b.lon);
    exact.push(end);
    const seconds = a.timeMs !== null && b.timeMs !== null ? (b.timeMs - a.timeMs) / 1000 : null;
    if (a.segment !== b.segment || (seconds !== null && seconds > GAP_SECONDS)) {
      gaps.push({ startMeters: round(start, 1), endMeters: round(end, 1), seconds });
    }
  }

  const elevations = gpx.points.map((p) => p.ele as number);
  const { gainMeters, lossMeters } = gainAndLoss(elevations);
  const lats = gpx.points.map((p) => p.lat);
  const lons = gpx.points.map((p) => p.lon);
  const firstTime = gpx.points[0]!.timeMs;

  const points: CoursePoint[] = gpx.points.map((p, i) => [
    round(p.lat, 6),
    round(p.lon, 6),
    round(p.ele as number, 1),
    round(exact[i]!, 1),
  ]);

  return {
    schemaVersion: 1,
    id: meta.id,
    name: meta.name,
    place: meta.place,
    summary: meta.summary,
    notes: meta.notes,
    source: {
      kind: gpx.creator?.toLowerCase().includes("garmin") ? "garmin-gpx" : "gpx",
      file: meta.gpx,
      sha256,
      trackName: gpx.trackName,
      creator: gpx.creator,
      recordedAt: firstTime === null ? null : new Date(firstTime).toISOString(),
      pointCount: gpx.points.length,
    },
    distanceMeters: round(exact[exact.length - 1]!, 1),
    elevation: {
      minMeters: round(Math.min(...elevations), 1),
      maxMeters: round(Math.max(...elevations), 1),
      startMeters: round(elevations[0]!, 1),
      endMeters: round(elevations[elevations.length - 1]!, 1),
      gainMeters: round(gainMeters, 1),
      lossMeters: round(lossMeters, 1),
      method: GAIN_METHOD,
    },
    bounds: [round(Math.min(...lats), 6), round(Math.min(...lons), 6), round(Math.max(...lats), 6), round(Math.max(...lons), 6)],
    gaps,
    points,
  };
}

/**
 * Checks a course's data for the problems that would break the screen or mislead: wrong shape,
 * out-of-range coordinates, distances that go backwards, or totals that disagree with the points.
 * Returns plain-language problems; an empty list means the data is sound.
 */
export function courseProblems(data: unknown): string[] {
  const problems: string[] = [];
  if (typeof data !== "object" || data === null) return ["Course data is not an object."];
  const d = data as Partial<CourseData>;

  if (d.schemaVersion !== 1) problems.push("Unsupported schemaVersion (expected 1).");
  for (const key of ["id", "name", "place", "summary"] as const) {
    if (typeof d[key] !== "string" || d[key] === "") problems.push(`Missing ${key}.`);
  }
  if (typeof d.id === "string" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id)) problems.push("id must be lower-case words joined by hyphens.");
  if (!Array.isArray(d.notes) || d.notes.some((n) => typeof n !== "string")) problems.push("notes must be a list of text.");

  const points = d.points;
  if (!Array.isArray(points) || points.length < 2) {
    problems.push("A course needs at least two points.");
    return problems;
  }
  let previous = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || p.length !== 4 || p.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      problems.push(`Point ${i + 1} is not four finite numbers [lat, lon, ele, dist].`);
      return problems;
    }
    const [lat, lon, , dist] = p as unknown as CoursePoint;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) problems.push(`Point ${i + 1} has coordinates out of range.`);
    if (i === 0 && dist !== 0) problems.push("The first point must be at distance 0.");
    if (dist < previous) problems.push(`Distance goes backwards at point ${i + 1}.`);
    previous = dist;
  }
  const last = (points[points.length - 1] as unknown as CoursePoint)[3];
  if (typeof d.distanceMeters !== "number" || Math.abs(d.distanceMeters - last) > 0.05) {
    problems.push("distanceMeters does not match the last point.");
  }
  if (!d.elevation || typeof d.elevation.gainMeters !== "number" || typeof d.elevation.lossMeters !== "number") {
    problems.push("Missing elevation summary.");
  } else {
    const eles = (points as unknown as CoursePoint[]).map((p) => p[2]);
    if (Math.abs(d.elevation.minMeters - Math.min(...eles)) > 0.05 || Math.abs(d.elevation.maxMeters - Math.max(...eles)) > 0.05) {
      problems.push("Elevation min/max do not match the points.");
    }
  }
  if (!Array.isArray(d.gaps)) problems.push("gaps must be a list.");
  else {
    for (const g of d.gaps) {
      if (!(g.startMeters >= 0 && g.endMeters > g.startMeters && g.endMeters <= last + 0.05)) problems.push("A gap lies outside the course.");
    }
  }
  if (!Array.isArray(d.bounds) || d.bounds.length !== 4) problems.push("bounds must be [south, west, north, east].");
  return problems;
}
