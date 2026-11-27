import { describe, expect, it } from "vitest";
import { calculateRace } from "../../src/engine";
import type { RaceCalculation, RaceConfig } from "../../src/engine";
import { COURSE_MATCH_TOLERANCE, gradeAt, legFactor, matchesCourse, projectRace } from "../../src/adjust/project";
import { COURSES } from "../../src/courses";
import type { CourseData } from "../../src/courses/types";
import { GAP_RECORDING } from "../fixtures/gapRecording";
import { tinyCourse } from "../courses/helpers";

function race(config: RaceConfig): RaceCalculation {
  const result = calculateRace(config);
  if (!result.ok) throw new Error("test race should be valid");
  return result.value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A straight 1000 m course through the given [distance, elevation] pairs, no gaps. */
function slope(profile: Array<[number, number]>, gaps: CourseData["gaps"] = []): CourseData {
  const last = profile[profile.length - 1]![0];
  return tinyCourse({
    distanceMeters: last,
    gaps,
    points: profile.map(([d, e]) => [10 + d / 111000, 20, e, d] as const),
  });
}

const KM_MANUAL_250 = (time: number): RaceConfig => ({
  totalDistanceMeters: 1000,
  targetTimeSeconds: time,
  intervalMode: "manual",
  intervalDistanceMeters: 250,
});

describe("matchesCourse", () => {
  it("accepts a race within 3% of the course length, either way, and nothing else", () => {
    expect(COURSE_MATCH_TOLERANCE).toBe(0.03);
    expect(matchesCourse(1000, 1000)).toBe(true);
    expect(matchesCourse(970, 1000)).toBe(true);
    expect(matchesCourse(1030, 1000)).toBe(true);
    expect(matchesCourse(969, 1000)).toBe(false);
    expect(matchesCourse(1031, 1000)).toBe(false);
    expect(matchesCourse(5000, 5092.4)).toBe(true); // a 5K on John Hunt Park
    expect(matchesCourse(1609.344, 5092.4)).toBe(false); // a mile race is not this course
    expect(matchesCourse(10000, 0)).toBe(false);
  });
});

describe("gradeAt", () => {
  it("measures rise over a 100 m window, in percent", () => {
    expect(gradeAt(slope([[0, 0], [1000, 50]]), 500).gradePercent).toBeCloseTo(5, 9);
    expect(gradeAt(slope([[0, 50], [1000, 0]]), 500).gradePercent).toBeCloseTo(-5, 9);
  });

  it("keeps the window inside the course at the start and end (same grade, not a smaller one)", () => {
    const course = slope([[0, 0], [1000, 50]]);
    expect(gradeAt(course, 0).gradePercent).toBeCloseTo(5, 9);
    expect(gradeAt(course, 1000).gradePercent).toBeCloseTo(5, 9);
  });

  it("flags windows that touch the stretch where nothing was recorded", () => {
    const course = slope([[0, 0], [1000, 50]], [{ startMeters: 400, endMeters: 600, seconds: 30 }]);
    expect(gradeAt(course, 345).touchesGap).toBe(false); // window 295..395
    expect(gradeAt(course, 355).touchesGap).toBe(true); // window 305..405
    expect(gradeAt(course, 500).touchesGap).toBe(true);
    expect(gradeAt(course, 655).touchesGap).toBe(false); // window 605..705
    expect(gradeAt(course, 645).touchesGap).toBe(true); // window 595..695
  });
});

describe("projectRace on a hand-made course", () => {
  it("a steady 5% climb: every leg and the total are 1.2225 times the flat time", () => {
    const rows = projectRace(race(KM_MANUAL_250(300)), slope([[0, 0], [1000, 50]]));
    if (rows.kind !== "ok") throw new Error("expected ok");
    expect(rows.originalSeconds).toBe(300);
    expect(rows.estimatedSeconds).toBeCloseTo(300 * 1.2225, 9); // 366.75
    expect(rows.differenceSeconds).toBeCloseTo(66.75, 9);
    expect(rows.rows).toHaveLength(4);
    for (const row of rows.rows) expect(row.legFactor).toBeCloseTo(1.2225, 9);
    // First leg: 250 m of a 300 s / 1000 m race = 75 s flat, x 1.2225.
    expect(rows.rows[0]!.originalSeconds).toBeCloseTo(75, 9);
    expect(rows.rows[0]!.estimatedSeconds).toBeCloseTo(91.6875, 9);
    expect(rows.rows[0]!.differenceSeconds).toBeCloseTo(16.6875, 9);
  });

  it("a steady 5% descent: every leg is 0.93333 times the flat time", () => {
    const result = projectRace(race(KM_MANUAL_250(300)), slope([[0, 50], [1000, 0]]));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimatedSeconds).toBeCloseTo(300 * (1 - (0.12 * 5) / 9), 9); // 280
    expect(result.differenceSeconds).toBeLessThan(0);
  });

  it("a flat course changes nothing", () => {
    const result = projectRace(race(KM_MANUAL_250(300)), slope([[0, 7], [1000, 7]]));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimatedSeconds).toBeCloseTo(300, 9);
    for (const row of result.rows) expect(row.estimatedSeconds).toBeCloseTo(row.originalSeconds, 9);
  });

  it("up then down: climbing costs more than the descent gives back, and the end legs are pure", () => {
    const result = projectRace(race(KM_MANUAL_250(300)), slope([[0, 0], [500, 25], [1000, 0]]));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rows[0]!.legFactor).toBeCloseTo(1.2225, 9); // pieces 5..245 m: windows all on the climb
    expect(result.rows[3]!.legFactor).toBeCloseTo(1 - (0.12 * 5) / 9, 9); // pieces 755..995 m: all on the descent
    expect(result.estimatedSeconds).toBeGreaterThan(300);
  });

  it("anything inside or next to the unrecorded stretch counts as flat, and is reported", () => {
    const course = slope([[0, 0], [1000, 50]], [{ startMeters: 400, endMeters: 600, seconds: 30 }]);
    const result = projectRace(race(KM_MANUAL_250(300)), course);
    if (result.kind !== "ok") throw new Error("expected ok");
    // Leg 250..500: pieces centred 255..345 (10 pieces) climb; 355..495 (15 pieces) are next to the gap.
    expect(result.rows[1]!.legFactor).toBeCloseTo((10 * 1.2225 + 15) / 25, 9); // 1.089
    expect(result.rows[0]!.legFactor).toBeCloseTo(1.2225, 9);
    expect(result.rows[3]!.legFactor).toBeCloseTo(1.2225, 9);
    // 150 m in each of the two middle legs: 300 m of 1000 m.
    expect(result.unrecordedShare).toBeCloseTo(0.3, 9);
  });

  it("legFactor reports the unrecorded meters it skipped", () => {
    const course = slope([[0, 0], [1000, 50]], [{ startMeters: 400, endMeters: 600, seconds: 30 }]);
    expect(legFactor(course, 250, 500).unrecordedMeters).toBeCloseTo(150, 9);
    expect(legFactor(course, 0, 250).unrecordedMeters).toBe(0);
    expect(legFactor(course, 5, 5).factor).toBe(1); // an empty leg is flat
  });

  it("maps a slightly shorter race onto the whole course and keeps the race's own distances", () => {
    const result = projectRace(race({ totalDistanceMeters: 970, targetTimeSeconds: 291, intervalMode: "manual", intervalDistanceMeters: 485 }), slope([[0, 0], [1000, 50]]));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.raceMeters).toBe(970);
    expect(result.courseMeters).toBe(1000);
    expect(result.rows.map((r) => r.distanceMeters)).toEqual([485, 970]);
    expect(result.estimatedSeconds).toBeCloseTo(291 * 1.2225, 9);
  });

  it("refuses a race of a different length instead of guessing", () => {
    const result = projectRace(race({ totalDistanceMeters: 2000, targetTimeSeconds: 600, intervalMode: "automatic" }), slope([[0, 0], [1000, 50]]));
    expect(result).toEqual({ kind: "distance_mismatch", raceMeters: 2000, courseMeters: 1000 });
  });

  it("pace over the whole race is the estimated time per mile", () => {
    const result = projectRace(race(KM_MANUAL_250(300)), slope([[0, 0], [1000, 50]]));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimatedPaceSecondsPerMile).toBeCloseTo((366.75 / 1000) * 1609.344, 6);
    expect(result.originalPaceSecondsPerMile).toBeCloseTo((300 / 1000) * 1609.344, 6);
  });
});

describe("projectRace never changes the race it is given", () => {
  it("works on a frozen race (any attempt to modify it would throw) and leaves it equal to a fresh copy", () => {
    const original = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" });
    const frozen = deepFreeze(structuredClone(original));
    expect(() => projectRace(frozen, COURSES[0]!)).not.toThrow();
    expect(frozen).toEqual(original);
  });

  it("the original target times in the rows are the engine's own numbers, exactly", () => {
    const flat = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" });
    const result = projectRace(flat, COURSES[0]!);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rows.map((r) => r.originalSeconds)).toEqual(flat.splits.map((s) => s.targetTimeSeconds));
    expect(result.originalSeconds).toBe(flat.totalTimeSeconds);
    expect(result.originalPaceSecondsPerMile).toBe(flat.paceSecondsPerMile);
  });
});

describe("projectRace on the John Hunt Park run (a 20:00 5K)", () => {
  const course = COURSES.find((c) => c.id === "john-hunt-park")!;
  const flat = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" });
  const result = projectRace(flat, course);
  if (result.kind !== "ok") throw new Error("expected ok");

  it("estimates a finish about 1% slower than the flat target, because it has about 39 m of climbing over 5 km", () => {
    expect(result.estimatedSeconds).toBeGreaterThan(1200 * 1.005);
    expect(result.estimatedSeconds).toBeLessThan(1200 * 1.02);
    expect(result.estimatedSeconds).toBeCloseTo(1212.13, 1); // checked against a separate Python calculation
  });

  it("matches the separate calculation leg by leg (factors 1.0045, 1.0078, 1.0219, 0.9739)", () => {
    const expected = [1.0045, 1.0078, 1.0219, 0.9739];
    result.rows.forEach((row, i) => expect(row.legFactor).toBeCloseTo(expected[i]!, 3));
  });

  it("has one row per engine split, the finish last, with estimated times that only go up", () => {
    expect(result.rows.map((r) => r.id)).toEqual(flat.splits.map((s) => s.id));
    expect(result.rows[result.rows.length - 1]!.isFinish).toBe(true);
    expect(result.rows[result.rows.length - 1]!.estimatedSeconds).toBe(result.estimatedSeconds);
    for (let i = 1; i < result.rows.length; i++) expect(result.rows[i]!.estimatedSeconds).toBeGreaterThan(result.rows[i - 1]!.estimatedSeconds);
  });

  it("every leg factor stays inside what the rule can produce", () => {
    for (const row of result.rows) {
      expect(row.legFactor).toBeGreaterThanOrEqual(0.88);
      expect(row.legFactor).toBeLessThanOrEqual(2.52);
    }
  });

  it("reports that none of the route had to be treated as flat (the recording has no gap)", () => {
    expect(result.unrecordedShare).toBe(0);
  });

  it("the leg times add up to the estimated total", () => {
    let previous = 0;
    let sum = 0;
    for (const row of result.rows) {
      sum += row.estimatedSeconds - previous;
      previous = row.estimatedSeconds;
    }
    expect(sum).toBeCloseTo(result.estimatedSeconds, 9);
  });
});

describe("projectRace on a real recording with a gap (the saved October 17 run, kept as a test fixture)", () => {
  const flat = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" });
  const result = projectRace(flat, GAP_RECORDING);
  if (result.kind !== "ok") throw new Error("expected ok");

  it("estimates 1238.06 s, as an independent Python calculation does (factors 1.0341, 1.0454, 1.0223, 0.9695)", () => {
    expect(result.estimatedSeconds).toBeCloseTo(1238.06, 1);
    const expected = [1.0341, 1.0454, 1.0223, 0.9695];
    result.rows.forEach((row, i) => expect(row.legFactor).toBeCloseTo(expected[i]!, 3));
  });

  it("reports that about 5% of the route (the unrecorded stretch and its neighbourhood) was treated as flat", () => {
    expect(result.unrecordedShare).toBeGreaterThan(0.03);
    expect(result.unrecordedShare).toBeLessThan(0.08);
  });
});
