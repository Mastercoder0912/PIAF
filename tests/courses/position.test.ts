import { describe, expect, it } from "vitest";
import { clampDistance, positionAt } from "../../src/courses/position";
import { COURSES } from "../../src/courses";
import { GAP_RECORDING } from "../fixtures/gapRecording";
import { tinyCourse } from "./helpers";

// tinyCourse: straight line north, points at 0, 100, 200, 300 m; elevation 10, 20, 10, 10; gap from 100 to 200 m.
// Each 100 m is 0.001 degrees of latitude in this hand-made data, so lat = 10 + meters / 100000.

describe("clampDistance", () => {
  const course = tinyCourse();
  it("keeps distances inside the course", () => {
    expect(clampDistance(course, 150)).toBe(150);
    expect(clampDistance(course, -5)).toBe(0);
    expect(clampDistance(course, 9999)).toBe(300);
    expect(clampDistance(course, 0)).toBe(0);
    expect(clampDistance(course, 300)).toBe(300);
  });
  it("treats anything that isn't a number as the start", () => {
    expect(clampDistance(course, Number.NaN)).toBe(0);
    expect(clampDistance(course, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("positionAt: interpolation between recorded points", () => {
  const course = tinyCourse();

  it("is exactly the first point at 0 and the last point at the end", () => {
    expect(positionAt(course, 0)).toMatchObject({ distanceMeters: 0, lat: 10, lon: 20, elevationMeters: 10 });
    expect(positionAt(course, 300)).toMatchObject({ distanceMeters: 300, lat: 10.003, lon: 20, elevationMeters: 10 });
  });

  it("is exactly a recorded point at that point's distance", () => {
    expect(positionAt(course, 100)).toMatchObject({ lat: 10.001, elevationMeters: 20 });
    expect(positionAt(course, 200)).toMatchObject({ lat: 10.002, elevationMeters: 10 });
  });

  it("is halfway between two points at the halfway distance (lat and elevation both)", () => {
    const p = positionAt(course, 50);
    expect(p.lat).toBeCloseTo(10.0005, 12);
    expect(p.elevationMeters).toBeCloseTo(15, 12);
    const q = positionAt(course, 250);
    expect(q.lat).toBeCloseTo(10.0025, 12);
    expect(q.elevationMeters).toBeCloseTo(10, 12);
  });

  it("interpolates unevenly spaced points by distance, not by index", () => {
    const uneven = tinyCourse({
      distanceMeters: 100,
      gaps: [],
      points: [[0, 0, 0, 0], [0.0001, 0, 10, 10], [0.001, 0, 100, 100]],
    });
    expect(positionAt(uneven, 55).lat).toBeCloseTo(0.0001 + (45 / 90) * 0.0009, 12);
    expect(positionAt(uneven, 5).elevationMeters).toBeCloseTo(5, 12);
  });

  it("clamps out-of-range distances", () => {
    expect(positionAt(course, -50).distanceMeters).toBe(0);
    expect(positionAt(course, 1e9)).toMatchObject({ distanceMeters: 300, lat: 10.003 });
    expect(positionAt(course, Number.NaN).distanceMeters).toBe(0);
  });

  it("handles repeated points (zero-length steps) without NaN", () => {
    const stationary = tinyCourse({
      distanceMeters: 100,
      gaps: [],
      points: [[5, 5, 1, 0], [5, 5, 1, 0], [5, 5, 1, 0], [5.001, 5, 2, 100]],
    });
    for (const d of [0, 0.0001, 50, 100]) {
      const p = positionAt(stationary, d);
      expect(Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.elevationMeters)).toBe(true);
    }
    expect(positionAt(stationary, 50).lat).toBeCloseTo(5.0005, 12);
  });
});

describe("positionAt: gaps", () => {
  const course = tinyCourse();
  it("is inside a gap strictly between its ends", () => {
    expect(positionAt(course, 150).inGap).toBe(true);
    expect(positionAt(course, 100.01).inGap).toBe(true);
    expect(positionAt(course, 199.99).inGap).toBe(true);
  });
  it("is not in a gap at the recorded points on either side, or elsewhere", () => {
    for (const d of [0, 50, 100, 200, 250, 300]) expect(positionAt(course, d).inGap).toBe(false);
  });
  it("is never in a gap when the course has none", () => {
    expect(positionAt(tinyCourse({ gaps: [] }), 150).inGap).toBe(false);
  });
});

describe("positionAt on the real John Hunt Park data", () => {
  const course = COURSES.find((c) => c.id === "john-hunt-park")!;

  it("returns each recorded point exactly at its own distance", () => {
    for (let i = 0; i < course.points.length; i += 17) {
      const [lat, lon, ele, dist] = course.points[i]!;
      // Skip points that share a distance with a neighbour (standing still): any of them is a correct answer.
      if (course.points[i - 1]?.[3] === dist || course.points[i + 1]?.[3] === dist) continue;
      const p = positionAt(course, dist);
      expect(p.lat).toBeCloseTo(lat, 9);
      expect(p.lon).toBeCloseTo(lon, 9);
      expect(p.elevationMeters).toBeCloseTo(ele, 9);
    }
  });

  it("always lies within the course's bounds and elevation range, and reports the distance asked for", () => {
    const [south, west, north, east] = course.bounds;
    for (let d = 0; d <= course.distanceMeters; d += 7.3) {
      const p = positionAt(course, d);
      expect(p.distanceMeters).toBeCloseTo(d, 9);
      expect(p.lat).toBeGreaterThanOrEqual(south);
      expect(p.lat).toBeLessThanOrEqual(north);
      expect(p.lon).toBeGreaterThanOrEqual(west);
      expect(p.lon).toBeLessThanOrEqual(east);
      expect(p.elevationMeters).toBeGreaterThanOrEqual(course.elevation.minMeters - 1e-9);
      expect(p.elevationMeters).toBeLessThanOrEqual(course.elevation.maxMeters + 1e-9);
    }
  });

  it("moves continuously: 1 m of course is never more than about 1.5 m on the ground", () => {
    // A marker must not jump when the slider moves a little: steps of 1 m of course distance must move the marker
    // about 1 m (straight lines between points can only be shorter).
    const metersPerDegreeLat = 110950; // near 34.7 N
    const metersPerDegreeLon = 91880;
    expect(course.gaps).toEqual([]);
    let previous = positionAt(course, 0);
    for (let d = 1; d <= course.distanceMeters; d += 1) {
      const p = positionAt(course, d);
      const jump = Math.hypot((p.lat - previous.lat) * metersPerDegreeLat, (p.lon - previous.lon) * metersPerDegreeLon);
      expect(jump).toBeLessThan(1.5);
      expect(p.inGap).toBe(false);
      previous = p;
    }
  });
});

describe("positionAt across a real recording gap (the saved October 17 run, kept as a test fixture)", () => {
  const course = GAP_RECORDING;

  it("moves continuously outside the gap", () => {
    const metersPerDegreeLat = 110950;
    const metersPerDegreeLon = 91880;
    const gap = course.gaps[0]!;
    let previous = positionAt(course, 0);
    for (let d = 1; d <= course.distanceMeters; d += 1) {
      const p = positionAt(course, d);
      const jump = Math.hypot((p.lat - previous.lat) * metersPerDegreeLat, (p.lon - previous.lon) * metersPerDegreeLon);
      if (!(d > gap.startMeters && d - 1 < gap.endMeters)) expect(jump).toBeLessThan(1.5);
      previous = p;
    }
  });

  it("flags exactly the middle of the recorded gap", () => {
    const gap = course.gaps[0]!;
    expect(gap).toEqual({ startMeters: 703.9, endMeters: 871.2, seconds: 41 });
    expect(positionAt(course, (gap.startMeters + gap.endMeters) / 2).inGap).toBe(true);
    expect(positionAt(course, gap.startMeters - 1).inGap).toBe(false);
    expect(positionAt(course, gap.endMeters + 1).inGap).toBe(false);
  });
});
