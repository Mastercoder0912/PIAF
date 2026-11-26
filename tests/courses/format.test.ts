import { describe, expect, it } from "vitest";
import {
  FEET_PER_METER,
  describeGap,
  formatClimb,
  formatDistance,
  formatElevation,
  formatMiles,
  formatRecordedDate,
  metersToFeet,
  metersToMiles,
} from "../../src/courses/format";

describe("units", () => {
  it("uses the exact statute mile and the international foot", () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(FEET_PER_METER).toBeCloseTo(1 / 0.3048, 9);
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 9);
  });
});

describe("formatting", () => {
  it("shows distance in miles with kilometers alongside", () => {
    expect(formatMiles(1609.344)).toBe("1.00 mi");
    expect(formatMiles(5033.7)).toBe("3.13 mi"); // 3.1278
    expect(formatDistance(5033.7)).toBe("3.13 mi (5.03 km)");
    expect(formatDistance(0)).toBe("0.00 mi (0.00 km)");
  });

  it("shows elevation in feet with meters alongside (203.8 m = 668.6 ft)", () => {
    expect(formatElevation(203.8)).toBe("669 ft (203.8 m)");
    expect(formatElevation(0)).toBe("0 ft (0.0 m)");
    expect(formatElevation(-3.2)).toBe("-10 ft (-3.2 m)");
  });

  it("shows climb totals as whole feet and meters (76.5 m = 251.0 ft)", () => {
    expect(formatClimb(76.5)).toBe("251 ft (77 m)");
    expect(formatClimb(94.5)).toBe("310 ft (95 m)");
  });
});

describe("describeGap", () => {
  it("says how much is missing, for how long, and where (in miles)", () => {
    const text = describeGap({ startMeters: 703.9, endMeters: 871.2, seconds: 41 });
    expect(text).toContain("167 m");
    expect(text).toContain("about 41 seconds");
    expect(text).toContain("mile 0.44"); // 703.9 / 1609.344
    expect(text).toContain("mile 0.54"); // 871.2 / 1609.344
    expect(text).toContain("dashed");
  });

  it("leaves the duration out when the file has no timestamps", () => {
    expect(describeGap({ startMeters: 100, endMeters: 200, seconds: null })).not.toContain("seconds");
  });
});

describe("formatRecordedDate", () => {
  it("writes the date without depending on the viewer's locale or time zone", () => {
    expect(formatRecordedDate("2026-10-17T15:00:35.000Z")).toBe("October 17, 2026");
    expect(formatRecordedDate("2026-01-05T00:00:00.000Z")).toBe("January 5, 2026");
    expect(formatRecordedDate("2026-12-31T23:59:59.000Z")).toBe("December 31, 2026");
  });
  it("is null when there is no usable date", () => {
    expect(formatRecordedDate(null)).toBeNull();
    expect(formatRecordedDate("yesterday")).toBeNull();
    expect(formatRecordedDate("2026-13-01T00:00:00Z")).toBeNull();
  });
});
