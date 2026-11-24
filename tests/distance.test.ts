import { describe, expect, it } from "vitest";
import {
  METERS_PER_KILOMETER,
  METERS_PER_MILE,
  convertDistance,
  distancesEqual,
  formatDistanceLabel,
  fromMeters,
  isDistanceUnit,
  toMeters,
} from "../src/engine/distance";
import type { DistanceUnit } from "../src/engine/types";

describe("constants", () => {
  it("uses the exact statute mile and kilometer", () => {
    expect(METERS_PER_MILE).toBe(1609.344);
    expect(METERS_PER_KILOMETER).toBe(1000);
  });
});

describe("distance conversions", () => {
  it("converts to meters", () => {
    expect(toMeters(1, "mi")).toBeCloseTo(1609.344, 9);
    expect(toMeters(5, "km")).toBe(5000);
    expect(toMeters(800, "m")).toBe(800);
  });

  it("converts from meters", () => {
    expect(fromMeters(1609.344, "mi")).toBeCloseTo(1, 12);
    expect(fromMeters(10000, "km")).toBe(10);
    expect(fromMeters(42195, "m")).toBe(42195);
  });

  it("converts between non-meter units", () => {
    expect(convertDistance(10, "km", "mi")).toBeCloseTo(6.2137119224, 9); // known 10K in miles
    expect(convertDistance(26.2, "mi", "km")).toBeCloseTo(42.1648128, 7);
    expect(convertDistance(1, "mi", "km")).toBeCloseTo(1.609344, 12);
  });

  it("round-trips without drift for every unit pair", () => {
    const units: DistanceUnit[] = ["m", "km", "mi"];
    for (const from of units) {
      for (const to of units) {
        for (const value of [0.001, 1, 3.7, 26.2, 100, 12345.678]) {
          const back = convertDistance(convertDistance(value, from, to), to, from);
          expect(Math.abs(back - value) / value).toBeLessThan(1e-12);
        }
      }
    }
  });

  it("does not round (1600 m is NOT 1 mile)", () => {
    expect(fromMeters(1600, "mi")).toBeCloseTo(0.99419, 5);
    expect(fromMeters(1600, "mi")).not.toBe(1);
  });

  it("rejects an unsupported unit instead of returning NaN", () => {
    expect(() => toMeters(1, "yd" as DistanceUnit)).toThrow(RangeError);
    expect(() => fromMeters(1, "furlong" as DistanceUnit)).toThrow(RangeError);
  });
});

describe("isDistanceUnit", () => {
  it("accepts only the three supported units", () => {
    expect(isDistanceUnit("m")).toBe(true);
    expect(isDistanceUnit("km")).toBe(true);
    expect(isDistanceUnit("mi")).toBe(true);
  });

  it("rejects everything else, including prototype property names", () => {
    for (const bad of ["yd", "M", "", "miles", "toString", "constructor", "__proto__", 5, null, undefined]) {
      expect(isDistanceUnit(bad)).toBe(false);
    }
  });
});

describe("distancesEqual", () => {
  it("treats floating-point noise as equal", () => {
    expect(distancesEqual(3 * 1609.344, 4828.032)).toBe(true);
    expect(distancesEqual(0.1 * 3, 0.3)).toBe(true);
  });

  it("keeps genuinely different distances apart (1600 m vs 1 mile)", () => {
    expect(distancesEqual(1600, METERS_PER_MILE)).toBe(false);
    expect(distancesEqual(1000, 1000.001)).toBe(false);
  });

  it("uses the 1e-6 m tolerance as documented", () => {
    expect(distancesEqual(100, 100 + 5e-7)).toBe(true);
    expect(distancesEqual(100, 100 + 2e-6)).toBe(false);
  });
});

describe("formatDistanceLabel (display only)", () => {
  it("labels whole miles as miles and everything else in meters", () => {
    expect(formatDistanceLabel(200)).toBe("200 m");
    expect(formatDistanceLabel(1600)).toBe("1600 m");
    expect(formatDistanceLabel(METERS_PER_MILE)).toBe("1 mile");
    expect(formatDistanceLabel(2 * METERS_PER_MILE)).toBe("2 miles");
    expect(formatDistanceLabel(5000)).toBe("5000 m");
    expect(formatDistanceLabel(1.5)).toBe("1.5 m");
    expect(formatDistanceLabel(333.333333)).toBe("333.33 m");
  });

  it("does not turn sub-mile distances into '0 miles'", () => {
    expect(formatDistanceLabel(800)).toBe("800 m");
    expect(formatDistanceLabel(0.5)).toBe("0.5 m");
  });

  it("does not change the underlying number", () => {
    const meters = 333.333333;
    formatDistanceLabel(meters);
    expect(meters).toBe(333.333333);
  });
});
