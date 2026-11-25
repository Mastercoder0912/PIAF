/**
 * Course data format (schema version 1).
 *
 * A course is stored as one JSON file per course in src/courses/data/, GENERATED from a GPX file by
 * `npm run courses` (see courses/README.md). Nothing in the app invents or edits course geometry: every
 * number here comes from the GPX, or is a documented calculation on it.
 *
 * Units: meters everywhere. Display conversion (miles, feet) lives in format.ts.
 */

/** [latitude, longitude, elevation in meters, distance from the start in meters] */
export type CoursePoint = readonly [lat: number, lon: number, ele: number, dist: number];

/** A stretch where nothing was recorded (watch paused, GPS lost). The route is a straight line across it. */
export interface CourseGap {
  startMeters: number;
  endMeters: number;
  /** Seconds between the two points, when the GPX has timestamps. */
  seconds: number | null;
}

export interface CourseSource {
  kind: "garmin-gpx" | "gpx";
  /** The original file, kept unchanged next to course.json. */
  file: string;
  /** SHA-256 of that file, so the data can be traced to exactly one export. */
  sha256: string;
  trackName: string | null;
  creator: string | null;
  /** ISO time of the first point, when present. */
  recordedAt: string | null;
  pointCount: number;
}

export interface CourseElevation {
  minMeters: number;
  maxMeters: number;
  startMeters: number;
  endMeters: number;
  /** Total climbing and descending, from the lightly smoothed profile. An estimate. */
  gainMeters: number;
  lossMeters: number;
  /** How gain and loss were calculated, in words (shown in the course notes). */
  method: string;
}

export interface CourseData {
  schemaVersion: 1;
  id: string;
  name: string;
  place: string;
  /** One honest sentence about what this route is. */
  summary: string;
  /** Extra caveats shown with the course. */
  notes: string[];
  source: CourseSource;
  distanceMeters: number;
  elevation: CourseElevation;
  /** [south, west, north, east] */
  bounds: readonly [number, number, number, number];
  gaps: CourseGap[];
  points: CoursePoint[];
}

/** The hand-written part of a course: what the person adds next to the GPX file. */
export interface CourseMeta {
  id: string;
  name: string;
  place: string;
  summary: string;
  notes: string[];
  /** File name of the GPX inside the same folder. */
  gpx: string;
}

/** Where a position along the course is, with everything the screen needs about it. */
export interface CoursePosition {
  distanceMeters: number;
  lat: number;
  lon: number;
  elevationMeters: number;
  /** True when the position is inside a gap, where the location is a straight-line estimate. */
  inGap: boolean;
}
