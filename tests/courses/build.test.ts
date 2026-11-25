// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GAP_SECONDS, buildCourse, courseProblems } from "../../src/courses/build";
import { gainAndLoss, movingAverage } from "../../src/courses/elevation";
import { stepMeters } from "../../src/courses/geo";
import { GpxError } from "../../src/courses/gpx";
import type { CourseMeta } from "../../src/courses/types";
import { gpx, tinyCourse } from "./helpers";

const meta: CourseMeta = { id: "test-course", name: "Test", place: "Nowhere", summary: "A test.", notes: ["note"], gpx: "t.gpx" };
const build = (text: string) => buildCourse(meta, text, "abc123");

describe("stepMeters: ground distance on the WGS-84 ellipsoid", () => {
  // Reference values are the published lengths of one degree on the WGS-84 ellipsoid, not computed from this code.
  it("a degree of latitude at the equator is about 110,574 m", () => {
    expect(stepMeters(0, 0, 1, 0)).toBeCloseTo(110574, -1); // within 5 m
  });

  it("a degree of longitude at the equator is about 111,319 m", () => {
    expect(stepMeters(0, 0, 0, 1)).toBeCloseTo(111319, -1);
  });

  it("a degree of longitude at 60 degrees north is about 55,800 m (half the equator's, give or take the ellipsoid)", () => {
    expect(stepMeters(60, 0, 60, 1)).toBeCloseTo(55800, -1);
  });

  it("a degree of latitude at 60 degrees north is about 111,412 m", () => {
    expect(stepMeters(59.5, 0, 60.5, 0)).toBeCloseTo(111412, -1);
  });

  it("is zero for the same point, symmetric, and handles negative and mixed coordinates", () => {
    expect(stepMeters(34.6849, -86.587, 34.6849, -86.587)).toBe(0);
    expect(stepMeters(34.6849, -86.587, 34.69, -86.58)).toBeCloseTo(stepMeters(34.69, -86.58, 34.6849, -86.587), 9);
    expect(stepMeters(-33.9, 151.2, -33.9, 151.201)).toBeGreaterThan(90);
  });
});

describe("elevation gain and loss", () => {
  it("moving average uses a centered 5-point window, shrinking at the ends", () => {
    expect(movingAverage([0, 10, 20, 30, 40])).toEqual([10, 15, 20, 25, 30]);
    expect(movingAverage([5])).toEqual([5]);
    expect(movingAverage([])).toEqual([]);
  });

  it("a steady climb of 10 m gains 8 m after smoothing the end points, and loses nothing", () => {
    // Smoothed ends are avg(0,1,2) = 1 and avg(8,9,10) = 9. A monotone climb gains exactly end - start.
    const { gainMeters, lossMeters } = gainAndLoss([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(gainMeters).toBeCloseTo(8, 9);
    expect(lossMeters).toBeCloseTo(0, 9);
  });

  it("a steady descent is a loss, not a gain", () => {
    const { gainMeters, lossMeters } = gainAndLoss([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(gainMeters).toBeCloseTo(0, 9);
    expect(lossMeters).toBeCloseTo(8, 9);
  });

  it("sensor flicker on flat ground adds almost nothing (hand-worked: 0.0933 m instead of 0.6 m)", () => {
    // [0,.2,0,.2,0,.2,0] smooths to [.0667,.1,.08,.12,.08,.1,.0667]; rises: .0333 + .04 + .02.
    const { gainMeters } = gainAndLoss([0, 0.2, 0, 0.2, 0, 0.2, 0]);
    expect(gainMeters).toBeCloseTo(0.0933333, 6);
  });

  it("flat ground gains and loses nothing; one point or none is safe", () => {
    expect(gainAndLoss([100, 100, 100, 100])).toEqual({ gainMeters: 0, lossMeters: 0 });
    expect(gainAndLoss([100])).toEqual({ gainMeters: 0, lossMeters: 0 });
    expect(gainAndLoss([])).toEqual({ gainMeters: 0, lossMeters: 0 });
  });
});

describe("buildCourse", () => {
  const along = (n: number, ele = 100) => Array.from({ length: n }, (_, i) => ({ lat: 0, lon: i * 0.001, ele, time: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z` }));

  it("measures distance along the track (3 steps of 0.001 degrees on the equator = 3 x 111.3195 m)", () => {
    const course = build(gpx([along(4)]));
    expect(course.points.map((p) => p[3])).toEqual([0, 111.3, 222.6, 334]);
    expect(course.distanceMeters).toBe(334);
  });

  it("keeps every point, in order, with coordinates, elevation and the running distance", () => {
    const course = build(gpx([[{ lat: 1, lon: 2, ele: 10 }, { lat: 1.001, lon: 2, ele: 12 }, { lat: 1.002, lon: 2, ele: 11 }]]));
    expect(course.points).toHaveLength(3);
    expect(course.points.map((p) => [p[0], p[1], p[2]])).toEqual([[1, 2, 10], [1.001, 2, 12], [1.002, 2, 11]]);
    expect(course.source.pointCount).toBe(3);
  });

  it("summarises elevation from the data: min, max, start, end", () => {
    const e = build(gpx([[{ lat: 0, lon: 0, ele: 50 }, { lat: 0, lon: 0.001, ele: 80 }, { lat: 0, lon: 0.002, ele: 20 }, { lat: 0, lon: 0.003, ele: 30 }]])).elevation;
    expect([e.minMeters, e.maxMeters, e.startMeters, e.endMeters]).toEqual([20, 80, 50, 30]);
  });

  it("records bounds as [south, west, north, east]", () => {
    const course = build(gpx([[{ lat: 10, lon: 20, ele: 1 }, { lat: 12, lon: 19, ele: 1 }, { lat: 11, lon: 21, ele: 1 }]]));
    expect(course.bounds).toEqual([10, 19, 12, 21]);
  });

  it("passes the hand-written details and the file fingerprint through unchanged", () => {
    const course = build(gpx([along(3)], { creator: "Garmin Connect", name: "My run" }));
    expect(course).toMatchObject({ schemaVersion: 1, id: "test-course", name: "Test", place: "Nowhere", summary: "A test.", notes: ["note"] });
    expect(course.source).toMatchObject({ kind: "garmin-gpx", file: "t.gpx", sha256: "abc123", trackName: "My run", creator: "Garmin Connect", recordedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("calls a non-Garmin file plain gpx, and leaves the date empty when there are no timestamps", () => {
    const course = build(gpx([[{ lat: 0, lon: 0, ele: 1 }, { lat: 0, lon: 0.001, ele: 1 }]], { creator: "Some App" }));
    expect(course.source.kind).toBe("gpx");
    expect(course.source.recordedAt).toBeNull();
  });

  it("produces data that passes its own checks", () => {
    expect(courseProblems(build(gpx([along(10)])))).toEqual([]);
  });
});

describe("buildCourse: gaps are flagged, never smoothed away", () => {
  it(`a silence longer than ${GAP_SECONDS} seconds is a gap, with its length and where it falls`, () => {
    const pts = [
      { lat: 0, lon: 0, ele: 1, time: "2026-01-01T00:00:00Z" },
      { lat: 0, lon: 0.001, ele: 1, time: "2026-01-01T00:00:01Z" },
      { lat: 0, lon: 0.002, ele: 1, time: "2026-01-01T00:00:42Z" }, // 41 s later
      { lat: 0, lon: 0.003, ele: 1, time: "2026-01-01T00:00:43Z" },
    ];
    const course = build(gpx([pts]));
    expect(course.gaps).toEqual([{ startMeters: 111.3, endMeters: 222.6, seconds: 41 }]);
    // The straight-line distance across the gap is still counted: 3 steps of 111.3195 m.
    expect(course.distanceMeters).toBe(334);
  });

  it(`exactly ${GAP_SECONDS} seconds is not a gap, but one second more is`, () => {
    const make = (seconds: number) =>
      build(gpx([[{ lat: 0, lon: 0, ele: 1, time: "2026-01-01T00:00:00Z" }, { lat: 0, lon: 0.001, ele: 1, time: `2026-01-01T00:00:${String(seconds).padStart(2, "0")}Z` }]]));
    expect(make(GAP_SECONDS).gaps).toEqual([]);
    expect(make(GAP_SECONDS + 1).gaps).toHaveLength(1);
  });

  it("a break between track segments is a gap too", () => {
    const course = build(gpx([[{ lat: 0, lon: 0, ele: 1 }, { lat: 0, lon: 0.001, ele: 1 }], [{ lat: 0, lon: 0.002, ele: 1 }, { lat: 0, lon: 0.003, ele: 1 }]]));
    expect(course.gaps).toEqual([{ startMeters: 111.3, endMeters: 222.6, seconds: null }]);
  });

  it("with no timestamps and one segment there is nothing to flag", () => {
    expect(build(gpx([[{ lat: 0, lon: 0, ele: 1 }, { lat: 0, lon: 0.5, ele: 1 }]])).gaps).toEqual([]);
  });
});

describe("buildCourse: refuses to guess", () => {
  const codeOf = (text: string) => {
    try {
      build(text);
    } catch (error) {
      return error instanceof GpxError ? error.code : `other:${String(error)}`;
    }
    return "none";
  };

  it("stops if any point has no elevation, and says how many", () => {
    const text = gpx([[{ lat: 0, lon: 0, ele: 1 }, { lat: 0, lon: 0.001, ele: null }, { lat: 0, lon: 0.002, ele: null }]]);
    expect(codeOf(text)).toBe("missing_elevation");
    expect(() => build(text)).toThrow(/2 of 3 track points have no elevation/);
  });

  it("stops if no point has elevation", () => {
    expect(codeOf(gpx([[{ lat: 0, lon: 0, ele: null }, { lat: 0, lon: 0.001, ele: null }]]))).toBe("missing_elevation");
  });

  it("stops for a single point", () => {
    expect(codeOf(gpx([[{ lat: 0, lon: 0, ele: 1 }]]))).toBe("too_few_points");
  });

  it("passes parser errors straight through", () => {
    expect(codeOf("not xml")).toBe("not_xml");
    expect(codeOf(`<kml/>`)).toBe("not_gpx");
    expect(codeOf(`<gpx><trk><trkseg><trkpt lat="99" lon="0"/></trkseg></trk></gpx>`)).toBe("bad_coordinates");
  });
});

describe("courseProblems: catches data that would break or mislead the screen", () => {
  const ok = () => structuredClone(tinyCourse());

  it("accepts sound data", () => {
    expect(courseProblems(tinyCourse())).toEqual([]);
  });

  it.each([
    ["not an object", () => 5],
    ["null", () => null],
    ["wrong schema version", () => ({ ...ok(), schemaVersion: 2 })],
    ["no name", () => ({ ...ok(), name: "" })],
    ["a bad id", () => ({ ...ok(), id: "Not Valid!" })],
    ["notes that aren't text", () => ({ ...ok(), notes: [1] })],
    ["a single point", () => ({ ...ok(), points: [[1, 2, 3, 0]] })],
    ["a point that isn't four numbers", () => ({ ...ok(), points: [[1, 2, 3, 0], [1, 2, 3]] })],
    ["a NaN in a point", () => ({ ...ok(), points: [[1, 2, 3, 0], [1, 2, Number.NaN, 5]] })],
    ["latitude out of range", () => ({ ...ok(), points: [[95, 2, 3, 0], [1, 2, 3, 5]], distanceMeters: 5 })],
    ["a start that isn't at distance 0", () => ({ ...ok(), points: [[1, 2, 3, 4], [1, 2, 3, 300]] })],
    ["distances that go backwards", () => ({ ...ok(), points: [[1, 2, 3, 0], [1, 2, 3, 200], [1, 2, 3, 100], [1, 2, 3, 300]] })],
    ["a total that disagrees with the points", () => ({ ...ok(), distanceMeters: 999 })],
    ["elevation range that disagrees with the points", () => ({ ...ok(), elevation: { ...ok().elevation, maxMeters: 99 } })],
    ["a gap past the end", () => ({ ...ok(), gaps: [{ startMeters: 100, endMeters: 400, seconds: 1 }] })],
    ["an empty gap", () => ({ ...ok(), gaps: [{ startMeters: 100, endMeters: 100, seconds: 1 }] })],
    ["bad bounds", () => ({ ...ok(), bounds: [1, 2] })],
  ])("flags %s", (_label, make) => {
    expect(courseProblems(make()).length).toBeGreaterThan(0);
  });
});
