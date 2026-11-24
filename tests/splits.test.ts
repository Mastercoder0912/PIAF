import { describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../src/engine/distance";
import {
  automaticMarkerDistances,
  buildSplits,
  calculateRace,
  manualMarkerDistances,
  uniqueSortedDistances,
} from "../src/engine/splits";
import type { RaceCalculation, RaceConfig } from "../src/engine/types";
import { validateSplits } from "../src/engine/validation";
import { EPS, at, errorCodes, unwrap } from "./helpers";

const auto = (totalDistanceMeters: number, pace = 360): RaceCalculation =>
  unwrap(
    calculateRace({ totalDistanceMeters, targetPaceSecondsPerMile: pace, intervalMode: "automatic" }),
  );

const manual = (totalDistanceMeters: number, intervalDistanceMeters: number, pace = 360): RaceCalculation =>
  unwrap(
    calculateRace({
      totalDistanceMeters,
      targetPaceSecondsPerMile: pace,
      intervalMode: "manual",
      intervalDistanceMeters,
    }),
  );

const distancesOf = (calc: RaceCalculation): number[] => calc.splits.map((s) => s.distanceMeters);

function expectDistances(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(at(actual, i)).toBeCloseTo(value, 9));
}

// Automatic splits: three mutually exclusive rules, chosen by race distance.
//   shorter than one mile -> every 200 m      exactly one mile -> every 400 m (no 1600 m mark)
//   longer than one mile  -> whole-mile markers only
// Expected distances below are written out by hand from those rules (literal metres; one mile = 1609.344 m),
// not computed with the engine's own loops. Where a total is a whole number of miles I used exact decimal
// arithmetic: 1 mile = 1609.344, 2 miles = 3218.688, 3 miles = 4828.032, 9 miles = 14484.096,
// 10 miles = 16093.44, 26 miles = 41842.944.
describe("automatic mode: races shorter than one mile use 200 m splits", () => {
  it("400 m: 200 m, then the finish", () => {
    expectDistances(distancesOf(auto(400)), [200, 400]);
  });

  it("800 m: 200, 400, 600, then the finish", () => {
    const calc = auto(800);
    expectDistances(distancesOf(calc), [200, 400, 600, 800]);
    expect(calc.splits.map((s) => s.isFinish)).toEqual([false, false, false, true]);
  });

  it("1600 m (which is shorter than a mile): 200 m splits to 1400, then the finish at 1600", () => {
    const calc = auto(1600);
    expectDistances(distancesOf(calc), [200, 400, 600, 800, 1000, 1200, 1400, 1600]);
    expect(at(calc.splits, -1).isFinish).toBe(true);
    expect(at(calc.splits, -1).label).toBe("Finish (1600 m)");
    expect(calc.splits.filter((s) => s.distanceMeters === 1600)).toHaveLength(1);
  });

  it("a finish that is not a multiple of 200 m is still included, exactly", () => {
    expectDistances(distancesOf(auto(250)), [200, 250]);
    expectDistances(distancesOf(auto(1005)), [200, 400, 600, 800, 1000, 1005]);
    expect(at(auto(1005).splits, -1).distanceMeters).toBe(1005);
  });

  it("just under a mile (1609 m): 200 m splits to 1600, then the finish; no mile marker", () => {
    const distances = distancesOf(auto(1609));
    expectDistances(distances, [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1609]);
    expect(distances).not.toContain(1609.344);
  });

  it("shorter than the first interval, or exactly the first interval: just the finish", () => {
    for (const total of [150, 200]) {
      const calc = auto(total);
      expect(calc.splits).toHaveLength(1);
      expect(at(calc.splits, 0).distanceMeters).toBe(total);
      expect(at(calc.splits, 0).isFinish).toBe(true);
    }
  });

  it("contains no 400 m-only or mile markers: every split is a multiple of 200 m (except the finish)", () => {
    for (const total of [300, 800, 1000, 1500, 1609]) {
      for (const split of auto(total).splits.filter((s) => !s.isFinish)) {
        expect(split.distanceMeters % 200).toBe(0);
      }
    }
  });
});

describe("automatic mode: a race of exactly one mile uses 400 m splits", () => {
  it("1609.344 m: 400, 800, 1200, then the finish at exactly 1609.344 m", () => {
    const calc = auto(1609.344);
    expectDistances(distancesOf(calc), [400, 800, 1200, 1609.344]);
    const finish = at(calc.splits, -1);
    expect(finish.isFinish).toBe(true);
    expect(finish.distanceMeters).toBe(1609.344);
    expect(finish.label).toBe("Finish (1 mile)");
  });

  it("has no 1600 m split, no 200 m splits, and no extra mile marker", () => {
    const calc = auto(1609.344);
    const distances = distancesOf(calc);
    expect(distances).not.toContain(1600);
    expect(distances.some((d) => d === 200 || d === 600 || d === 1000)).toBe(false);
    expect(calc.splits).toHaveLength(4);
    expect(calc.splits.filter((s) => s.isFinish)).toHaveLength(1);
  });

  it("the finish time is the exact 1-mile time (360 s at 6:00/mile)", () => {
    expect(at(auto(1609.344, 360).splits, -1).targetTimeSeconds).toBeCloseTo(360, 12);
  });

  it("a mile typed as 1609.344 in another route (1.609344 km) gets the same splits", () => {
    expectDistances(distancesOf(auto(1.609344 * 1000)), [400, 800, 1200, 1609.344]);
  });
});

describe("automatic mode: races longer than one mile use whole-mile markers only", () => {
  it("5000 m: 1 mile, 2 miles, 3 miles, then the finish; no sub-mile splits", () => {
    const calc = auto(5000);
    expectDistances(distancesOf(calc), [1609.344, 3218.688, 4828.032, 5000]);
    expect(calc.splits.filter((s) => s.distanceMeters < 1609.344)).toHaveLength(0);
    for (const forbidden of [200, 400, 800, 1200, 1600]) {
      expect(distancesOf(calc)).not.toContain(forbidden);
    }
  });

  it("slightly longer than a mile (1700 m): the 1-mile marker and the finish only", () => {
    const calc = auto(1700);
    expectDistances(distancesOf(calc), [1609.344, 1700]);
    expect(calc.splits.map((s) => s.label)).toEqual(["1 mile", "Finish (1700 m)"]);
  });

  it("1610 m (a hair over a mile): still whole-mile rules, with no sub-mile intervals", () => {
    const distances = distancesOf(auto(1610));
    expectDistances(distances, [1609.344, 1610]);
  });

  it("a race ending between mile markers still ends at its exact finish (1 km past 2 miles)", () => {
    const total = 4218.688;
    const calc = auto(total);
    expectDistances(distancesOf(calc), [1609.344, 3218.688, 4218.688]);
    expect(at(calc.splits, -1).distanceMeters).toBe(total);
    expect(at(calc.splits, -1).isFinish).toBe(true);
  });

  it("a race ending exactly on a mile marker has one finish and no duplicate", () => {
    const two = auto(3218.688);
    expectDistances(distancesOf(two), [1609.344, 3218.688]);
    expect(two.splits.filter((s) => s.isFinish)).toHaveLength(1);
    expect(at(two.splits, -1).label).toBe("Finish (2 miles)");

    const three = auto(4828.032);
    expectDistances(distancesOf(three), [1609.344, 3218.688, 4828.032]);
    expect(three.splits.filter((s) => Math.abs(s.distanceMeters - 4828.032) < 1e-6)).toHaveLength(1);
  });

  it("10 miles: markers at miles 1 to 9, then the finish at 10 (10 splits)", () => {
    const calc = auto(16093.44);
    expect(calc.splits).toHaveLength(10);
    expect(at(calc.splits, -2).distanceMeters).toBeCloseTo(14484.096, 9);
    expect(at(calc.splits, -2).label).toBe("9 miles");
    expect(at(calc.splits, -1).label).toBe("Finish (10 miles)");
  });

  it("marathon (42195 m): miles 1 to 26, then the finish (27 splits)", () => {
    const calc = auto(42195);
    expect(calc.splits).toHaveLength(27);
    expect(at(calc.splits, -2).distanceMeters).toBeCloseTo(41842.944, 9);
    expect(at(calc.splits, -1).distanceMeters).toBe(42195);
  });

  it("every marker is a whole number of miles", () => {
    for (const split of auto(21097.5).splits.filter((s) => !s.isFinish)) {
      expect(Math.abs(split.distanceMeters / 1609.344 - Math.round(split.distanceMeters / 1609.344))).toBeLessThan(1e-9);
    }
  });
});

describe("automatic mode: the distinction between 1600 m and one mile", () => {
  it("1600 m is a 200 m race and one mile is a 400 m race: different rules, different splits", () => {
    expect(distancesOf(auto(1600))).toHaveLength(8);
    expect(distancesOf(auto(1609.344))).toHaveLength(4);
    expect(at(auto(1600).splits, -1).distanceMeters).toBe(1600);
    expect(at(auto(1609.344).splits, -1).distanceMeters).toBe(1609.344);
  });

  it("1600 m never turns into a mile: no mile marker anywhere in a 1600 m race", () => {
    expect(distancesOf(auto(1600))).not.toContain(1609.344);
    expect(auto(1600).splits.some((s) => s.label.includes("mile"))).toBe(false);
  });

  it("one mile never gets a 1600 m split, and 1600 m never gets 400 m-only splits", () => {
    expect(distancesOf(auto(1609.344))).not.toContain(1600);
    expect(auto(1600).splits.filter((s) => !s.isFinish).every((s) => s.distanceMeters % 200 === 0)).toBe(true);
  });
});

describe("automatic mode: general behavior", () => {
  it("marks only the last split as the finish", () => {
    for (const total of [800, 1609.344, 5000]) {
      const calc = auto(total);
      expect(calc.splits.filter((s) => s.isFinish)).toHaveLength(1);
      expect(at(calc.splits, -1).isFinish).toBe(true);
      expect(at(calc.splits, -1).distanceMeters).toBe(total);
    }
  });

  it("ignores intervalDistanceMeters", () => {
    const withInterval = unwrap(
      calculateRace({
        totalDistanceMeters: 5000,
        targetPaceSecondsPerMile: 360,
        intervalMode: "automatic",
        intervalDistanceMeters: 777,
      }),
    );
    expect(distancesOf(withInterval)).toEqual(distancesOf(auto(5000)));
  });

  it("the rules do not combine: no race ever mixes 200 m splits with mile markers", () => {
    for (const total of [200, 800, 1600, 1609, 1609.344, 1610, 1700, 5000, 10000, 42195]) {
      const markers = distancesOf(auto(total)).slice(0, -1);
      const hasMile = markers.some((d) => d >= 1609.344 - 1e-6);
      const hasSub = markers.some((d) => d < 1609.344 - 1e-6);
      expect(hasMile && hasSub).toBe(false);
    }
  });
});

describe("manual mode", () => {
  it("5000 m every 400 m: 12 markers plus the finish", () => {
    const calc = manual(5000, 400);
    expect(calc.splits).toHaveLength(13);
    expectDistances(distancesOf(calc), [400, 800, 1200, 1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400, 4800, 5000]);
  });

  it("always includes the finish even when the distance is not divisible by the interval", () => {
    const calc = manual(1000, 333);
    expectDistances(distancesOf(calc), [333, 666, 999, 1000]);
    expect(at(calc.splits, -1).isFinish).toBe(true);
  });

  it("divisible distance: the last interval marker is the finish, represented once", () => {
    const calc = manual(5000, 1000);
    expectDistances(distancesOf(calc), [1000, 2000, 3000, 4000, 5000]);
    expect(calc.splits.filter((s) => s.isFinish)).toHaveLength(1);
  });

  it("interval equal to the race distance: finish only", () => {
    const calc = manual(5000, 5000);
    expect(calc.splits).toHaveLength(1);
    expect(at(calc.splits, 0).isFinish).toBe(true);
  });

  it("interval longer than the race (distance shorter than the first interval): finish only", () => {
    const calc = manual(800, 1000);
    expect(calc.splits).toHaveLength(1);
    expect(at(calc.splits, 0).distanceMeters).toBe(800);
    expect(at(calc.splits, 0).isFinish).toBe(true);
  });

  it("supports a fractional interval without floating-point stragglers", () => {
    // 10 * 0.1 is 1 exactly here, but 3 * 0.1 is 0.30000000000000004; neither may create an extra split.
    const calc = manual(1, 0.1);
    expect(calc.splits).toHaveLength(10);
    expect(at(calc.splits, -1).distanceMeters).toBe(1);
    expect(at(calc.splits, -2).distanceMeters).toBeCloseTo(0.9, 12);
  });

  it("works with a mile-sized interval", () => {
    const calc = manual(4828.032, METERS_PER_MILE);
    expectDistances(distancesOf(calc), [METERS_PER_MILE, 2 * METERS_PER_MILE, 4828.032]);
    expect(calc.splits.filter((s) => s.isFinish)).toHaveLength(1);
  });

  it("labels whole-mile markers as miles and others in meters", () => {
    const labels = manual(5000, METERS_PER_MILE).splits.map((s) => s.label);
    expect(labels).toEqual(["1 mile", "2 miles", "3 miles", "Finish (5000 m)"]);
  });
});

describe("exact interval/finish coincidence under floating-point noise", () => {
  it("3 * 1609.344 as a computed total still yields one finish at 3 miles", () => {
    const total = 3 * METERS_PER_MILE;
    const calc = manual(total, METERS_PER_MILE);
    expect(calc.splits).toHaveLength(3);
    expect(calc.splits.filter((s) => s.isFinish)).toHaveLength(1);
  });

  it("a typed total of 4828.032 (which may differ from 3*1609.344 in the last bit) still coincides", () => {
    expect(manual(4828.032, METERS_PER_MILE).splits).toHaveLength(3);
    expect(auto(4828.032).splits.filter((s) => s.isFinish)).toHaveLength(1);
    expect(auto(4828.032).splits).toHaveLength(3); // 1 mile, 2 miles, finish (3 miles)
  });

  it("a marker 5e-7 m short of the finish is absorbed into the finish, not duplicated", () => {
    const calc = manual(1000 + 5e-7, 500);
    expect(calc.splits).toHaveLength(2);
  });

  it("a marker 1e-3 m short of the finish is a real, separate split", () => {
    const calc = manual(1000.001, 500);
    expect(calc.splits).toHaveLength(3);
  });
});

describe("split content", () => {
  it("each split has id, distance, time, label and finish flag", () => {
    for (const split of auto(5000).splits) {
      expect(typeof split.id).toBe("string");
      expect(split.id.length).toBeGreaterThan(0);
      expect(Number.isFinite(split.distanceMeters)).toBe(true);
      expect(Number.isFinite(split.targetTimeSeconds)).toBe(true);
      expect(split.label.length).toBeGreaterThan(0);
      expect(typeof split.isFinish).toBe("boolean");
    }
  });

  it("labels are human-readable", () => {
    const labels = auto(5000).splits.map((s) => s.label);
    expect(labels).toEqual(["1 mile", "2 miles", "3 miles", "Finish (5000 m)"]);
    expect(auto(800).splits.map((s) => s.label)).toEqual(["200 m", "400 m", "600 m", "Finish (800 m)"]);
    expect(auto(1609.344).splits.map((s) => s.label)).toEqual(["400 m", "800 m", "1200 m", "Finish (1 mile)"]);
  });

  it("target times follow the pace without rounding", () => {
    // Pace 6:00 per mile (360 s). Expected values computed separately with exact fractions:
    //   200 m -> 44.73872584108805 s, 400 m -> 89.4774516821761 s, 1600 m -> 357.9098067287044 s.
    const sub = auto(800, 360);
    expect(at(sub.splits, 0).targetTimeSeconds).toBeCloseTo(44.73872584108805, 12);
    expect(Number.isInteger(at(sub.splits, 0).targetTimeSeconds)).toBe(false);

    const mile = auto(1609.344, 360);
    expect(at(mile.splits, 0).targetTimeSeconds).toBeCloseTo(89.4774516821761, 12);
    expect(at(mile.splits, -1).targetTimeSeconds).toBeCloseTo(360, 12);

    expect(at(auto(1600, 360).splits, -1).targetTimeSeconds).toBeCloseTo(357.9098067287044, 12);

    const long = auto(5000, 360);
    [360, 720, 1080].forEach((seconds, i) => expect(at(long.splits, i).targetTimeSeconds).toBeCloseTo(seconds, 12));
  });

  it("finish time equals the resolved total time exactly", () => {
    const fromTime = unwrap(
      calculateRace({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" }),
    );
    expect(at(fromTime.splits, -1).targetTimeSeconds).toBe(1200);
    expect(fromTime.totalTimeSeconds).toBe(1200);
    expect(fromTime.paceSecondsPerMile).toBeCloseTo(386.24256, 9);

    const fromPace = unwrap(
      calculateRace({ totalDistanceMeters: 5000, targetPaceSecondsPerMile: 420, intervalMode: "automatic" }),
    );
    expect(at(fromPace.splits, -1).targetTimeSeconds).toBe(fromPace.totalTimeSeconds);
    expect(Math.abs(fromPace.totalTimeSeconds - 1304.8795)).toBeLessThan(5e-5);
  });

  it("a time goal and the equivalent pace goal produce the same splits", () => {
    const byTime = unwrap(
      calculateRace({ totalDistanceMeters: 10000, targetTimeSeconds: 2400, intervalMode: "automatic" }),
    );
    const byPace = unwrap(
      calculateRace({ totalDistanceMeters: 10000, targetPaceSecondsPerMile: 386.24256, intervalMode: "automatic" }),
    );
    expect(byTime.splits).toHaveLength(byPace.splits.length);
    byTime.splits.forEach((split, i) => {
      expect(split.distanceMeters).toBeCloseTo(at(byPace.splits, i).distanceMeters, 9);
      expect(split.targetTimeSeconds).toBeCloseTo(at(byPace.splits, i).targetTimeSeconds, 9);
    });
  });
});

describe("duplicate prevention and ordering invariants", () => {
  const totals = [1, 99.5, 200, 400, 800, 1500, 1600, METERS_PER_MILE, 1610, 3000, 2 * METERS_PER_MILE, 5000, 10000, 21097.5, 42195];
  const intervals = [100, 250, 400, 1000, METERS_PER_MILE];

  function configsFor(total: number): RaceConfig[] {
    return [
      { totalDistanceMeters: total, targetPaceSecondsPerMile: 400, intervalMode: "automatic" },
      ...intervals.map((interval): RaceConfig => ({
        totalDistanceMeters: total,
        targetPaceSecondsPerMile: 400,
        intervalMode: "manual",
        intervalDistanceMeters: interval,
      })),
    ];
  }

  it("never produces duplicate distances, duplicate ids, or out-of-range splits", () => {
    for (const total of totals) {
      for (const config of configsFor(total)) {
        const calc = unwrap(calculateRace(config));
        expect(validateSplits(calc.splits, total).ok).toBe(true);
        expect(new Set(calc.splits.map((s) => s.id)).size).toBe(calc.splits.length);
      }
    }
  });

  it("is strictly increasing in distance and time, with exactly one finish at the end", () => {
    for (const total of totals) {
      for (const config of configsFor(total)) {
        const { splits } = unwrap(calculateRace(config));
        for (let i = 1; i < splits.length; i++) {
          expect(at(splits, i).distanceMeters).toBeGreaterThan(at(splits, i - 1).distanceMeters);
          expect(at(splits, i).targetTimeSeconds).toBeGreaterThan(at(splits, i - 1).targetTimeSeconds);
        }
        expect(splits.filter((s) => s.isFinish)).toHaveLength(1);
        expect(at(splits, -1).isFinish).toBe(true);
        expect(at(splits, -1).distanceMeters).toBe(total);
        expect(splits.every((s) => s.distanceMeters <= total)).toBe(true);
      }
    }
  });

  it("uniqueSortedDistances sorts and drops near-duplicates", () => {
    expect(uniqueSortedDistances([5, 1, 5, 5 + 1e-9, 3])).toEqual([1, 3, 5]);
    expect(uniqueSortedDistances([])).toEqual([]);
  });

  it("uniqueSortedDistances does NOT merge 1600 m with the mile", () => {
    expect(uniqueSortedDistances([1600, METERS_PER_MILE, 1600])).toEqual([1600, METERS_PER_MILE]);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    uniqueSortedDistances(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("buildSplits keeps the finish separate from the markers it is given", () => {
    const splits = buildSplits([100, 200], 300, 90, 483.0);
    expect(splits.map((s) => s.isFinish)).toEqual([false, false, true]);
    expect(at(splits, -1).targetTimeSeconds).toBe(90);
  });
});

describe("calculateRace with invalid input", () => {
  const base: RaceConfig = { totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "automatic" };

  it("returns errors instead of throwing or producing splits", () => {
    const bad: RaceConfig[] = [
      { ...base, totalDistanceMeters: 0 },
      { ...base, totalDistanceMeters: -5 },
      { ...base, targetTimeSeconds: 0 },
      { ...base, targetTimeSeconds: undefined },
      { ...base, targetPaceSecondsPerMile: 400 },
      { ...base, intervalMode: "manual" },
      { ...base, intervalMode: "manual", intervalDistanceMeters: -1 },
      { ...base, intervalMode: "weekly" as RaceConfig["intervalMode"] },
    ];
    for (const config of bad) {
      const result = calculateRace(config);
      expect(result.ok).toBe(false);
      expect(errorCodes(result).length).toBeGreaterThan(0);
    }
  });

  it("generators throw RangeError rather than freezing on absurd counts", () => {
    expect(() => manualMarkerDistances(10000, 0.001)).toThrow(RangeError);
    expect(() => automaticMarkerDistances(1e12)).toThrow(RangeError);
  });

  it("is deterministic: same input, same output, input untouched", () => {
    const config = Object.freeze({ ...base });
    const a = unwrap(calculateRace(config));
    const b = unwrap(calculateRace(config));
    expect(a).toEqual(b);
    expect(EPS).toBeGreaterThan(0);
  });
});
