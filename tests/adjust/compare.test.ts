import { describe, expect, it } from "vitest";
import { calculateRace } from "../../src/engine";
import { legEnds, projectPerformance } from "../../src/adjust/compare";
import { projectRace } from "../../src/adjust/project";
import { COURSES } from "../../src/courses";
import type { CourseData } from "../../src/courses/types";
import { tinyCourse } from "../courses/helpers";

/** A straight course through [distance, elevation] pairs with no unrecorded stretch. */
function course(id: string, profile: Array<[number, number]>): CourseData {
  return tinyCourse({
    id,
    name: id,
    distanceMeters: profile[profile.length - 1]![0],
    gaps: [],
    points: profile.map(([d, e]) => [10 + d / 111000, 20, e, d] as [number, number, number, number]),
  });
}

const FLAT_1K = course("flat", [[0, 0], [1000, 0]]);
const UP_1K = course("up", [[0, 0], [1000, 50]]); // steady +5%: factor 1 + 0.17 + 0.0525 = 1.2225
const DOWN_1K = course("down", [[0, 50], [1000, 0]]); // steady -5%: factor 1 - 0.12 x 5 / 9 = 0.93333...
// 1000 m is under a mile, so the legs are 200 m each: five of them.
const SIXTY = [60, 60, 60, 60, 60];

function ok(result: ReturnType<typeof projectPerformance>) {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
  return result;
}

describe("legEnds", () => {
  it("uses the app's automatic split legs: every whole mile, then the finish", () => {
    expect(legEnds(5000)).toEqual([1609.344, 3218.688, 4828.032, 5000]);
    expect(legEnds(1000)).toEqual([200, 400, 600, 800, 1000]);
  });
});

describe("projectPerformance", () => {
  it("moving from a hilly course to a flat one removes the old hills: time / 1.2225", () => {
    const r = ok(projectPerformance(1000, SIXTY, UP_1K, FLAT_1K));
    for (const row of r.rows) expect(row.newLegSeconds).toBeCloseTo(60 / 1.2225, 9); // 49.0798
    expect(r.oldSeconds).toBe(300);
    expect(r.newSeconds).toBeCloseTo(300 / 1.2225, 9); // 245.3988
    expect(r.differenceSeconds).toBeCloseTo(300 / 1.2225 - 300, 9);
    expect(r.differenceSeconds).toBeLessThan(0);
  });

  it("moving from a flat course to a hilly one adds the new hills: time x 1.2225", () => {
    const r = ok(projectPerformance(1000, SIXTY, FLAT_1K, UP_1K));
    expect(r.newSeconds).toBeCloseTo(300 * 1.2225, 9); // 366.75
    expect(r.rows[0]!.newCumulativeSeconds).toBeCloseTo(73.35, 9);
    expect(r.rows[4]!.newCumulativeSeconds).toBeCloseTo(366.75, 9);
  });

  it("uphill to downhill is the ratio of the two factors", () => {
    const r = ok(projectPerformance(1000, SIXTY, UP_1K, DOWN_1K));
    const expected = (60 * (1 - (0.12 * 5) / 9)) / 1.2225; // 45.8078...
    for (const row of r.rows) expect(row.newLegSeconds).toBeCloseTo(expected, 9);
  });

  it("the same course on both sides changes nothing (the entered times, to rounding error)", () => {
    const entered = [61.3, 58.2, 70.9, 55.5, 40.1];
    const r = ok(projectPerformance(1000, entered, UP_1K, UP_1K));
    r.rows.forEach((row, i) => expect(row.newLegSeconds).toBeCloseTo(entered[i]!, 9));
    expect(r.differenceSeconds).toBeCloseTo(0, 9);
  });

  it("keeps the runner's own pattern: only the hills change each leg", () => {
    // Old course climbs 5% for the first 500 m then is flat; new course is flat. Legs 1 and 5 are clear of the bend.
    const climbThenFlat = course("climb-then-flat", [[0, 0], [500, 25], [1000, 25]]);
    const entered = [70, 62, 61, 60, 60]; // a fast-fading pattern
    const r = ok(projectPerformance(1000, entered, climbThenFlat, FLAT_1K));
    expect(r.rows[0]!.oldFactor).toBeCloseTo(1.2225, 9);
    expect(r.rows[0]!.newFactor).toBe(1);
    expect(r.rows[0]!.newLegSeconds).toBeCloseTo(70 / 1.2225, 9); // 57.2597
    expect(r.rows[4]!.oldFactor).toBe(1);
    expect(r.rows[4]!.newLegSeconds).toBe(60); // already flat: untouched
    for (const row of r.rows) expect(row.newLegSeconds / row.oldLegSeconds).toBeCloseTo(row.newFactor / row.oldFactor, 12);
  });

  it("totals, cumulative times and paces add up", () => {
    const r = ok(projectPerformance(1000, SIXTY, FLAT_1K, UP_1K));
    let sum = 0;
    r.rows.forEach((row) => {
      sum += row.newLegSeconds;
      expect(row.newCumulativeSeconds).toBeCloseTo(sum, 9);
    });
    expect(r.rows[4]!.isFinish).toBe(true);
    expect(r.rows.slice(0, 4).every((row) => !row.isFinish)).toBe(true);
    expect(r.newPaceSecondsPerMile).toBeCloseTo((366.75 / 1000) * 1609.344, 6);
    expect(r.oldPaceSecondsPerMile).toBeCloseTo((300 / 1000) * 1609.344, 6);
    expect(r.rows[0]!.newLegPaceSecondsPerMile).toBeCloseTo((73.35 / 200) * 1609.344, 6);
  });

  it("refuses a course that doesn't fit the race distance, naming which one (old is checked first)", () => {
    const long = course("long", [[0, 0], [2000, 0]]);
    expect(projectPerformance(1000, SIXTY, FLAT_1K, long)).toEqual({ kind: "distance_mismatch", which: "new", raceMeters: 1000, courseMeters: 2000 });
    expect(projectPerformance(1000, SIXTY, long, FLAT_1K)).toEqual({ kind: "distance_mismatch", which: "old", raceMeters: 1000, courseMeters: 2000 });
    expect(projectPerformance(1000, SIXTY, long, long)).toMatchObject({ which: "old" });
  });

  it("rejects the wrong number of leg times and non-positive times (programming errors, the screen validates first)", () => {
    expect(() => projectPerformance(1000, [60, 60], FLAT_1K, FLAT_1K)).toThrow(RangeError);
    expect(() => projectPerformance(1000, [60, 60, 60, 60, 0], FLAT_1K, FLAT_1K)).toThrow(RangeError);
    expect(() => projectPerformance(1000, [60, 60, 60, 60, Number.NaN], FLAT_1K, FLAT_1K)).toThrow(RangeError);
  });

  it("reports how much of each course was treated as flat for lack of elevation", () => {
    const gappy = tinyCourse({
      id: "gappy",
      distanceMeters: 1000,
      gaps: [{ startMeters: 400, endMeters: 600, seconds: 30 }],
      points: [[10, 20, 0, 0], [10.009, 20, 50, 1000]],
    });
    const r = ok(projectPerformance(1000, SIXTY, gappy, FLAT_1K));
    expect(r.oldUnrecordedShare).toBeCloseTo(0.3, 9); // 150 m next to each end of the gap's 200 m stretch: see project.test.ts
    expect(r.newUnrecordedShare).toBe(0);
  });
});

describe("consistency with the single-course estimate", () => {
  const jhp = COURSES.find((c) => c.id === "john-hunt-park")!;
  const FLAT_5K = course("flat-5k", [[0, 0], [5000, 0]]);

  it("an even-paced run on a flat old course projects to the same times as the single-course estimate", () => {
    const race = calculateRace({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" });
    if (!race.ok) throw new Error("bad race");
    const single = projectRace(race.value, jhp);
    if (single.kind !== "ok") throw new Error("expected ok");

    const legs = legEnds(5000).map((end, i, ends) => (end - (i === 0 ? 0 : ends[i - 1]!)) * (1200 / 5000));
    const r = ok(projectPerformance(5000, legs, FLAT_5K, jhp));
    r.rows.forEach((row, i) => expect(row.newCumulativeSeconds).toBeCloseTo(single.rows[i]!.estimatedSeconds, 9));
    expect(r.newSeconds).toBeCloseTo(single.estimatedSeconds, 9);
  });

  it("John Hunt Park to itself returns the example 5K splits (5:53.4, 6:10.3, 6:59.5, 0:36.1)", () => {
    const legs = [353.4, 370.3, 419.5, 36.1];
    const r = ok(projectPerformance(5000, legs, jhp, jhp));
    r.rows.forEach((row, i) => expect(row.newLegSeconds).toBeCloseTo(legs[i]!, 9));
    expect(r.newSeconds).toBeCloseTo(1179.3, 9);
  });
});
