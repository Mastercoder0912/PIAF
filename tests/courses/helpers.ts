import type { CourseData } from "../../src/courses/types";

export interface TestPoint {
  lat: number;
  lon: number;
  ele?: number | null;
  time?: string | null;
}

/** A small GPX document. `segments` is a list of point lists (one <trkseg> each). */
export function gpx(segments: TestPoint[][], options: { creator?: string; name?: string; extraRoot?: string } = {}): string {
  const creator = options.creator ?? "Test";
  const seg = (points: TestPoint[]) =>
    `<trkseg>${points
      .map((p) => {
        const ele = p.ele === undefined ? "0" : p.ele;
        return `<trkpt lat="${p.lat}" lon="${p.lon}">${ele === null ? "" : `<ele>${ele}</ele>`}${p.time ? `<time>${p.time}</time>` : ""}</trkpt>`;
      })
      .join("")}</trkseg>`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx creator="${creator}" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:x="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">${options.extraRoot ?? ""}<trk><name>${options.name ?? "Test track"}</name>${segments.map(seg).join("")}</trk></gpx>`;
}

/**
 * A hand-made course for logic tests. Distances are given directly, so expected positions are easy to
 * work out by hand: a straight line 0 -> 100 -> 300 m, elevation 10 -> 20 -> 10, with a gap from 100 to 200 m.
 */
export function tinyCourse(overrides: Partial<CourseData> = {}): CourseData {
  return {
    schemaVersion: 1,
    id: "tiny",
    name: "Tiny",
    place: "Nowhere",
    summary: "A test course.",
    notes: [],
    source: { kind: "gpx", file: "tiny.gpx", sha256: "0", trackName: null, creator: null, recordedAt: null, pointCount: 3 },
    distanceMeters: 300,
    elevation: { minMeters: 10, maxMeters: 20, startMeters: 10, endMeters: 10, gainMeters: 10, lossMeters: 10, method: "test" },
    bounds: [10, 20, 10.003, 20],
    gaps: [{ startMeters: 100, endMeters: 200, seconds: 30 }],
    points: [
      [10, 20, 10, 0],
      [10.001, 20, 20, 100],
      [10.002, 20, 10, 200],
      [10.003, 20, 10, 300],
    ],
    ...overrides,
  };
}
