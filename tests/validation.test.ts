import { describe, expect, it } from "vitest";
import type { PacingLocation, RaceConfig, Split } from "../src/engine/types";
import {
  MAX_SPLITS,
  validateDistanceInput,
  validateDistanceUnit,
  validatePacingLocations,
  validateRaceConfig,
  validateSplits,
} from "../src/engine/validation";
import { at, errorCodes, unwrap } from "./helpers";

const valid: RaceConfig = {
  totalDistanceMeters: 5000,
  targetTimeSeconds: 1200,
  intervalMode: "automatic",
};

describe("validateRaceConfig: valid configs", () => {
  it("accepts a time goal", () => {
    expect(validateRaceConfig(valid).ok).toBe(true);
  });

  it("accepts a pace goal", () => {
    const config: RaceConfig = { totalDistanceMeters: 5000, targetPaceSecondsPerMile: 400, intervalMode: "automatic" };
    expect(validateRaceConfig(config).ok).toBe(true);
  });

  it("accepts manual mode with a positive interval", () => {
    expect(validateRaceConfig({ ...valid, intervalMode: "manual", intervalDistanceMeters: 400 }).ok).toBe(true);
  });

  it("returns the same config object on success", () => {
    expect(unwrap(validateRaceConfig(valid))).toBe(valid);
  });
});

describe("validateRaceConfig: distance", () => {
  it.each([0, -1, -5000, Number.NaN, Number.POSITIVE_INFINITY])("rejects totalDistanceMeters = %s", (distance) => {
    const result = validateRaceConfig({ ...valid, totalDistanceMeters: distance });
    expect(errorCodes(result)).toContain("INVALID_DISTANCE");
  });

  it("rejects a non-number distance", () => {
    const result = validateRaceConfig({ ...valid, totalDistanceMeters: "5000" as unknown as number });
    expect(errorCodes(result)).toContain("INVALID_DISTANCE");
  });
});

describe("validateRaceConfig: target time / pace", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects targetTimeSeconds = %s", (time) => {
    expect(errorCodes(validateRaceConfig({ ...valid, targetTimeSeconds: time }))).toEqual(["INVALID_TIME"]);
  });

  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])("rejects targetPaceSecondsPerMile = %s", (pace) => {
    const config: RaceConfig = { totalDistanceMeters: 5000, targetPaceSecondsPerMile: pace, intervalMode: "automatic" };
    expect(errorCodes(validateRaceConfig(config))).toEqual(["INVALID_PACE"]);
  });

  it("rejects a missing target", () => {
    const { targetTimeSeconds: _omit, ...noTarget } = valid;
    expect(errorCodes(validateRaceConfig(noTarget))).toEqual(["MISSING_TARGET"]);
  });

  it("treats null like 'not supplied'", () => {
    const config = { ...valid, targetTimeSeconds: null as unknown as undefined };
    expect(errorCodes(validateRaceConfig(config))).toEqual(["MISSING_TARGET"]);
  });

  it("rejects both a time and a pace", () => {
    const result = validateRaceConfig({ ...valid, targetPaceSecondsPerMile: 400 });
    expect(errorCodes(result)).toEqual(["CONFLICTING_TARGETS"]);
  });

  it("a supplied value of 0 is 'invalid', not 'missing'", () => {
    expect(errorCodes(validateRaceConfig({ ...valid, targetTimeSeconds: 0 }))).toEqual(["INVALID_TIME"]);
  });
});

describe("validateRaceConfig: intervals", () => {
  const manualConfig: RaceConfig = { ...valid, intervalMode: "manual" };

  it("requires an interval in manual mode", () => {
    expect(errorCodes(validateRaceConfig(manualConfig))).toEqual(["INVALID_INTERVAL"]);
  });

  it.each([0, -400, Number.NaN, Number.POSITIVE_INFINITY])("rejects manual interval %s", (interval) => {
    expect(
      errorCodes(validateRaceConfig({ ...manualConfig, intervalDistanceMeters: interval })),
    ).toEqual(["INVALID_INTERVAL"]);
  });

  it("rejects an interval that would create more than MAX_SPLITS splits", () => {
    const result = validateRaceConfig({
      ...manualConfig,
      totalDistanceMeters: 10000,
      intervalDistanceMeters: 10000 / (MAX_SPLITS + 1),
    });
    expect(errorCodes(result)).toEqual(["TOO_MANY_SPLITS"]);
  });

  it("allows exactly MAX_SPLITS splits", () => {
    const result = validateRaceConfig({
      ...manualConfig,
      totalDistanceMeters: 10000,
      intervalDistanceMeters: 10000 / MAX_SPLITS,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown interval mode", () => {
    const result = validateRaceConfig({ ...valid, intervalMode: "weekly" as RaceConfig["intervalMode"] });
    expect(errorCodes(result)).toEqual(["INVALID_INTERVAL_MODE"]);
  });

  it("does not validate the interval in automatic mode", () => {
    expect(validateRaceConfig({ ...valid, intervalDistanceMeters: -5 }).ok).toBe(true);
  });

  it("rejects automatic mode on an absurdly long race instead of looping", () => {
    const result = validateRaceConfig({ ...valid, totalDistanceMeters: 1e12 });
    expect(errorCodes(result)).toEqual(["TOO_MANY_SPLITS"]);
  });
});

describe("validateRaceConfig: error quality", () => {
  it("reports every problem at once, not just the first", () => {
    const result = validateRaceConfig({
      totalDistanceMeters: -1,
      targetTimeSeconds: 0,
      targetPaceSecondsPerMile: 0,
      intervalMode: "manual",
      intervalDistanceMeters: 0,
    });
    expect(errorCodes(result).sort()).toEqual(
      ["CONFLICTING_TARGETS", "INVALID_DISTANCE", "INVALID_INTERVAL", "INVALID_PACE", "INVALID_TIME"].sort(),
    );
  });

  it("gives every error a field and a readable message", () => {
    const result = validateRaceConfig({ totalDistanceMeters: 0, intervalMode: "manual" });
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(error.field.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(10);
      expect(error.message).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});

describe("validateDistanceUnit / validateDistanceInput", () => {
  it("accepts m, km and mi", () => {
    for (const unit of ["m", "km", "mi"]) expect(unwrap(validateDistanceUnit(unit))).toBe(unit);
  });

  it.each(["yd", "", "KM", "miles", null, undefined, 3])("rejects unit %j", (unit) => {
    expect(errorCodes(validateDistanceUnit(unit))).toEqual(["INVALID_DISTANCE_UNIT"]);
  });

  it("names the supported units in the message", () => {
    const result = validateDistanceUnit("yd");
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.message).toMatch(/"m", "km", "mi"/);
  });

  it("converts a valid distance to meters", () => {
    expect(unwrap(validateDistanceInput(5, "km"))).toBe(5000);
    expect(unwrap(validateDistanceInput(1, "mi"))).toBeCloseTo(1609.344, 9);
    expect(unwrap(validateDistanceInput(800, "m"))).toBe(800);
  });

  it("rejects zero / negative / non-finite distances", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorCodes(validateDistanceInput(value, "m"))).toEqual(["INVALID_DISTANCE"]);
    }
  });

  it("reports a bad unit and a bad distance together", () => {
    expect(errorCodes(validateDistanceInput(-1, "yd")).sort()).toEqual(["INVALID_DISTANCE", "INVALID_DISTANCE_UNIT"]);
  });
});

describe("validatePacingLocations", () => {
  const loc = (id: string, distanceMeters: number, overrides: Partial<PacingLocation> = {}): PacingLocation => ({
    id,
    name: `Point ${id}`,
    distanceMeters,
    targetTimeSeconds: distanceMeters / 4,
    ...overrides,
  });

  it("accepts locations inside the race, including exactly at the finish", () => {
    expect(validatePacingLocations([loc("a", 1000), loc("b", 3000), loc("c", 5000)], 5000).ok).toBe(true);
  });

  it("accepts an empty list", () => {
    expect(validatePacingLocations([], 5000).ok).toBe(true);
  });

  it("rejects a location beyond the race distance, with a helpful message", () => {
    const result = validatePacingLocations([loc("a", 6000)], 5000);
    expect(errorCodes(result)).toEqual(["BEYOND_RACE_DISTANCE"]);
    if (result.ok) throw new Error("expected failure");
    expect(at(result.errors, 0).message).toContain("6000 m");
    expect(at(result.errors, 0).message).toContain("5000 m");
    expect(at(result.errors, 0).field).toBe("locations[0].distanceMeters");
  });

  it("tolerates floating-point noise at the finish", () => {
    expect(validatePacingLocations([loc("a", 5000 + 1e-9)], 5000).ok).toBe(true);
    expect(errorCodes(validatePacingLocations([loc("a", 5000.001)], 5000))).toEqual(["BEYOND_RACE_DISTANCE"]);
  });

  it.each([0, -100, Number.NaN])("rejects a location at distance %s", (distance) => {
    expect(errorCodes(validatePacingLocations([loc("a", distance)], 5000))).toContain("INVALID_DISTANCE");
  });

  it("rejects two locations at the same distance (within tolerance)", () => {
    expect(errorCodes(validatePacingLocations([loc("a", 2000), loc("b", 2000)], 5000))).toEqual(["DUPLICATE_DISTANCE"]);
    expect(errorCodes(validatePacingLocations([loc("a", 2000), loc("b", 2000 + 1e-8)], 5000))).toEqual(["DUPLICATE_DISTANCE"]);
  });

  it("does NOT treat 1600 m and 1 mile as duplicates", () => {
    expect(validatePacingLocations([loc("a", 1600), loc("b", 1609.344)], 5000).ok).toBe(true);
  });

  it("rejects duplicate and empty ids", () => {
    expect(errorCodes(validatePacingLocations([loc("a", 1000), loc("a", 2000)], 5000))).toEqual(["DUPLICATE_ID"]);
    expect(errorCodes(validatePacingLocations([loc("", 1000)], 5000))).toEqual(["DUPLICATE_ID"]);
  });

  it("rejects blank names", () => {
    expect(errorCodes(validatePacingLocations([loc("a", 1000, { name: "   " })], 5000))).toEqual(["INVALID_NAME"]);
  });

  it.each([0, -5, Number.NaN])("rejects target time %s", (time) => {
    expect(errorCodes(validatePacingLocations([loc("a", 1000, { targetTimeSeconds: time })], 5000))).toEqual([
      "INVALID_TIME",
    ]);
  });

  it("rejects an invalid race distance", () => {
    expect(errorCodes(validatePacingLocations([loc("a", 1000)], 0))).toEqual(["INVALID_DISTANCE"]);
  });

  it("reports the index of each offending location", () => {
    const result = validatePacingLocations([loc("a", 1000), loc("b", 9000), loc("c", 9500)], 5000);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.map((e) => e.field)).toEqual(["locations[1].distanceMeters", "locations[2].distanceMeters"]);
  });
});

describe("validateSplits", () => {
  const split = (id: string, distanceMeters: number): Split => ({
    id,
    distanceMeters,
    targetTimeSeconds: distanceMeters / 4,
    label: `${distanceMeters} m`,
    isFinish: false,
  });

  it("accepts in-range, unique splits", () => {
    expect(validateSplits([split("1", 100), split("2", 200)], 300).ok).toBe(true);
  });

  it("rejects splits beyond the race distance", () => {
    expect(errorCodes(validateSplits([split("1", 100), split("2", 400)], 300))).toEqual(["BEYOND_RACE_DISTANCE"]);
  });

  it("rejects duplicate distances regardless of input order", () => {
    expect(errorCodes(validateSplits([split("1", 200), split("2", 100), split("3", 200)], 300))).toEqual([
      "DUPLICATE_DISTANCE",
    ]);
  });

  it("rejects duplicate ids", () => {
    expect(errorCodes(validateSplits([split("1", 100), split("1", 200)], 300))).toEqual(["DUPLICATE_ID"]);
  });
});
