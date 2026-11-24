import { describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../src/engine/distance";
import {
  completionTimeFromPace,
  paceFromDistanceAndTime,
  resolveRaceTarget,
  targetTimeAtDistance,
} from "../src/engine/pace";

/**
 * The five required cases from the spec. "Expected" values in the spec are
 * rounded, so each carries the tolerance its rounding implies.
 */
describe("required calculation table", () => {
  it("Pace from time: 5000 m in 1200 s -> 386.24256 sec/mile", () => {
    expect(paceFromDistanceAndTime(5000, 1200)).toBeCloseTo(386.24256, 9);
  });

  it("Time from pace: 5000 m at 420 sec/mile -> 1304.8795 sec", () => {
    const seconds = completionTimeFromPace(5000, 420);
    expect(Math.abs(seconds - 1304.8795)).toBeLessThan(5e-5); // spec value is rounded to 4 dp
  });

  it("Short-distance: 1600 m at 360 sec/mile -> 357.9098 sec", () => {
    const seconds = completionTimeFromPace(1600, 360);
    expect(Math.abs(seconds - 357.9098)).toBeLessThan(5e-5);
  });

  it("Exact mile: 1609.344 m at 360 sec/mile -> 360 sec", () => {
    expect(completionTimeFromPace(1609.344, 360)).toBeCloseTo(360, 12);
  });

  it("10K pace: 10000 m in 2400 s -> 386.24256 sec/mile", () => {
    expect(paceFromDistanceAndTime(10000, 2400)).toBeCloseTo(386.24256, 9);
  });
});

describe("independent cross-checks of the spec values", () => {
  // Recompute by a different route (miles first, then multiply) so a shared bug can't hide.
  it("agrees with the 'convert to miles, then multiply' route", () => {
    const miles5k = 5000 / 1609.344;
    expect(completionTimeFromPace(5000, 420)).toBeCloseTo(miles5k * 420, 9);
    expect(paceFromDistanceAndTime(5000, 1200)).toBeCloseTo(1200 / miles5k, 9);
  });

  it("5000 m and 10000 m at the same pace give identical sec/mile when time scales", () => {
    // 10K in exactly double the 5K time is the same pace.
    expect(paceFromDistanceAndTime(10000, 2400)).toBeCloseTo(paceFromDistanceAndTime(5000, 1200), 12);
  });
});

describe("targetTimeAtDistance", () => {
  it("is 0 at the start line", () => {
    expect(targetTimeAtDistance(0, 360)).toBe(0);
  });

  it("equals the pace at exactly one mile", () => {
    expect(targetTimeAtDistance(METERS_PER_MILE, 360)).toBeCloseTo(360, 12);
    expect(targetTimeAtDistance(2 * METERS_PER_MILE, 360)).toBeCloseTo(720, 12);
  });

  it("is linear in distance", () => {
    const pace = 391.7;
    const a = targetTimeAtDistance(400, pace);
    const b = targetTimeAtDistance(800, pace);
    const c = targetTimeAtDistance(1200, pace);
    expect(b).toBeCloseTo(2 * a, 12);
    expect(c).toBeCloseTo(3 * a, 12);
  });

  it("does not round intermediate values", () => {
    const seconds = targetTimeAtDistance(200, 360);
    expect(seconds).toBeCloseTo((200 * 360) / 1609.344, 12);
    expect(Number.isInteger(seconds)).toBe(false);
  });

  it("rejects bad input", () => {
    expect(() => targetTimeAtDistance(-1, 360)).toThrow(RangeError);
    expect(() => targetTimeAtDistance(Number.NaN, 360)).toThrow(RangeError);
    expect(() => targetTimeAtDistance(100, 0)).toThrow(RangeError);
    expect(() => targetTimeAtDistance(100, -5)).toThrow(RangeError);
    expect(() => targetTimeAtDistance(100, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("paceFromDistanceAndTime / completionTimeFromPace guards", () => {
  it("throw instead of returning Infinity or NaN", () => {
    expect(() => paceFromDistanceAndTime(0, 100)).toThrow(RangeError);
    expect(() => paceFromDistanceAndTime(100, 0)).toThrow(RangeError);
    expect(() => paceFromDistanceAndTime(-100, 100)).toThrow(RangeError);
    expect(() => paceFromDistanceAndTime(100, Number.NaN)).toThrow(RangeError);
    expect(() => completionTimeFromPace(0, 360)).toThrow(RangeError);
    expect(() => completionTimeFromPace(5000, 0)).toThrow(RangeError);
  });
});

describe("floating-point precision", () => {
  it("pace -> time -> pace round-trips to within 1e-12 relative error", () => {
    for (const distance of [100, 200, 800, 1600, 1609.344, 5000, 10000, 21097.5, 42195, 160934.4]) {
      for (const pace of [240, 360, 386.24256, 420, 600, 900]) {
        const time = completionTimeFromPace(distance, pace);
        const back = paceFromDistanceAndTime(distance, time);
        expect(Math.abs(back - pace) / pace).toBeLessThan(1e-12);
      }
    }
  });

  it("splitting a race does not accumulate error: sum of equal legs equals the whole", () => {
    const pace = 391.37;
    const legs = 1000;
    const leg = targetTimeAtDistance(5000 / legs, pace);
    let sum = 0;
    for (let i = 0; i < legs; i++) sum += leg;
    expect(Math.abs(sum - completionTimeFromPace(5000, pace))).toBeLessThan(1e-9);
  });
});

describe("resolveRaceTarget", () => {
  it("resolves a time goal into pace", () => {
    const target = resolveRaceTarget(5000, { targetTimeSeconds: 1200 });
    expect(target.totalTimeSeconds).toBe(1200);
    expect(target.paceSecondsPerMile).toBeCloseTo(386.24256, 9);
  });

  it("resolves a pace goal into total time", () => {
    const target = resolveRaceTarget(5000, { targetPaceSecondsPerMile: 420 });
    expect(target.paceSecondsPerMile).toBe(420);
    expect(Math.abs(target.totalTimeSeconds - 1304.8795)).toBeLessThan(5e-5);
  });

  it("gives the same answer from either direction", () => {
    const fromPace = resolveRaceTarget(10000, { targetPaceSecondsPerMile: 386.24256 });
    const fromTime = resolveRaceTarget(10000, { targetTimeSeconds: 2400 });
    expect(fromPace.totalTimeSeconds).toBeCloseTo(fromTime.totalTimeSeconds, 9);
    expect(fromPace.paceSecondsPerMile).toBeCloseTo(fromTime.paceSecondsPerMile, 9);
  });

  it("throws unless exactly one goal is given", () => {
    expect(() => resolveRaceTarget(5000, {})).toThrow(RangeError);
    expect(() => resolveRaceTarget(5000, { targetTimeSeconds: 1200, targetPaceSecondsPerMile: 400 })).toThrow(
      RangeError,
    );
  });
});
