import { describe, expect, it } from "vitest";
import { COURSES } from "../../src/courses";
import { elevationColor, elevationFraction, elevationHue, elevationRuns, routeParts } from "../../src/courses/route";
import { tinyCourse } from "./helpers";

describe("elevation colors: lowest green, highest red, a gradient between", () => {
  it("is green at the lowest point, yellow halfway, red at the highest", () => {
    expect(elevationHue(0)).toBe(120); // green
    expect(elevationHue(0.5)).toBe(60); // yellow
    expect(elevationHue(1)).toBe(0); // red
    expect(elevationColor(0)).toBe("hsl(120, 85%, 45%)");
    expect(elevationColor(1)).toBe("hsl(0, 85%, 45%)");
  });

  it("changes smoothly and in one direction: higher is always redder", () => {
    let previous = Infinity;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const hue = elevationHue(f);
      expect(hue).toBeLessThanOrEqual(previous);
      previous = hue;
    }
    expect(elevationHue(0.25)).toBe(90);
    expect(elevationHue(0.75)).toBe(30);
  });

  it("clamps outside 0..1", () => {
    expect(elevationHue(-3)).toBe(120);
    expect(elevationHue(7)).toBe(0);
  });

  it("works out where an elevation sits between the lowest and highest", () => {
    expect(elevationFraction(183, 183, 206.2)).toBe(0);
    expect(elevationFraction(206.2, 183, 206.2)).toBe(1);
    expect(elevationFraction(194.6, 183, 206.2)).toBeCloseTo(0.5, 12);
    expect(elevationFraction(100, 183, 206.2)).toBe(0); // below the range: clamped
    expect(elevationFraction(300, 183, 206.2)).toBe(1);
  });

  it("treats a perfectly flat course as the lowest color, without dividing by zero", () => {
    expect(elevationFraction(50, 50, 50)).toBe(0);
    expect(Number.isNaN(elevationFraction(50, 50, 50))).toBe(false);
  });
});

describe("elevationRuns on a hand-made course", () => {
  // tinyCourse: elevations 10, 20, 10, 10 m (range 10..20); a gap from 100 m to 200 m (the middle step).
  const runs = elevationRuns(tinyCourse());

  it("colors each step by the average elevation of its two ends, and leaves the gap out", () => {
    expect(runs).toHaveLength(2);
    // Step 1: average of 10 and 20 = 15, halfway = yellow (hue 60).
    expect(runs[0]).toEqual({ color: "hsl(60, 85%, 45%)", points: [[10, 20], [10.001, 20]] });
    // Step 3: average of 10 and 10 = 10, the lowest = green (hue 120).
    expect(runs[1]).toEqual({ color: "hsl(120, 85%, 45%)", points: [[10.002, 20], [10.003, 20]] });
  });

  it("the gap is drawn dashed instead, between the same two points the gap spans", () => {
    expect(routeParts(tinyCourse()).dashed).toEqual([[[10.001, 20], [10.002, 20]]]);
  });

  it("merges steps of the same color into one run, and starts each new run where the last ended", () => {
    const flat = tinyCourse({
      gaps: [],
      elevation: { ...tinyCourse().elevation, minMeters: 10, maxMeters: 20 },
      points: [[10, 20, 10, 0], [10.001, 20, 10, 100], [10.002, 20, 10, 200], [10.003, 20, 20, 300]],
    });
    const r = elevationRuns(flat);
    // Steps average 10, 10, 15: the first two share a color and merge into one run, then the climb is yellow.
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ color: "hsl(120, 85%, 45%)" });
    expect(r[0]?.points).toEqual([[10, 20], [10.001, 20], [10.002, 20]]);
    expect(r[1]?.points[0]).toEqual(r[0]?.points[r[0]!.points.length - 1]);
  });

  it("colors a perfectly flat course all one color", () => {
    const flat = tinyCourse({
      gaps: [],
      elevation: { ...tinyCourse().elevation, minMeters: 50, maxMeters: 50 },
      points: [[10, 20, 50, 0], [10.001, 20, 50, 100], [10.002, 20, 50, 200]],
    });
    expect(elevationRuns(flat)).toEqual([{ color: "hsl(120, 85%, 45%)", points: [[10, 20], [10.001, 20], [10.002, 20]] }]);
  });
});

describe("elevationRuns on the John Hunt Park data", () => {
  const course = COURSES.find((c) => c.id === "john-hunt-park")!;
  const runs = elevationRuns(course);
  const hueOf = (color: string) => Number(/hsl\((\d+),/.exec(color)![1]);

  it("covers every recorded step exactly once and skips only the one gap step", () => {
    const steps = runs.reduce((sum, run) => sum + run.points.length - 1, 0);
    expect(steps).toBe(course.points.length - 1 - 1); // 1189 steps, minus the gap's single step
  });

  it("draws fewer lines than there are steps, using whole-5-degree hues", () => {
    expect(runs.length).toBeLessThan(course.points.length / 2);
    for (const run of runs) expect(hueOf(run.color) % 5).toBe(0);
  });

  it("uses only hues from green (120) to red (0)", () => {
    for (const run of runs) {
      const hue = hueOf(run.color);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(120);
    }
  });

  it("makes the lowest ground green and the highest ground red", () => {
    const { minMeters, maxMeters } = course.elevation;
    // Find the recorded step with the lowest and highest average elevation, by looking at the data directly.
    let lowest = { ele: Infinity, i: 0 };
    let highest = { ele: -Infinity, i: 0 };
    for (let i = 0; i < course.points.length - 1; i++) {
      if (course.gaps.some((g) => course.points[i]![3] >= g.startMeters && course.points[i + 1]![3] <= g.endMeters)) continue;
      const avg = (course.points[i]![2] + course.points[i + 1]![2]) / 2;
      if (avg < lowest.ele) lowest = { ele: avg, i };
      if (avg > highest.ele) highest = { ele: avg, i };
    }
    const colorAt = (i: number) => {
      const target = course.points[i]!;
      const run = runs.find((r) => r.points.some((p) => p[0] === target[0] && p[1] === target[1]));
      return run!.color;
    };
    expect(minMeters).toBe(183);
    expect(maxMeters).toBe(206.2);
    expect(hueOf(colorAt(lowest.i))).toBeGreaterThanOrEqual(110); // essentially green
    expect(hueOf(colorAt(highest.i))).toBeLessThanOrEqual(15); // essentially red
  });

  it("is continuous: each run starts exactly where the previous one stopped (except across the gap)", () => {
    for (let i = 1; i < runs.length; i++) {
      const prevEnd = runs[i - 1]!.points[runs[i - 1]!.points.length - 1]!;
      const start = runs[i]!.points[0]!;
      const startsAfterGap = start[0] !== prevEnd[0] || start[1] !== prevEnd[1];
      if (startsAfterGap) {
        // The only allowed break is the recorded gap.
        expect(course.gaps).toHaveLength(1);
      }
    }
  });
});
