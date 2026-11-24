import { describe, expect, it } from "vitest";
import { ON_TARGET_TOLERANCE_SECONDS, STATUS_LABEL, comparePassingTime } from "../../src/live/comparison";
import {
  describeDifference,
  formatActualTime,
  formatSignedDifference,
  formatStopwatch,
  formatTargetTime,
} from "../../src/live/format";

describe("comparePassingTime: ahead / behind / on target", () => {
  it("the default tolerance is 1.00 second", () => {
    expect(ON_TARGET_TOLERANCE_SECONDS).toBe(1);
  });

  it("spec example: target 5:00.00, actual 4:58.50 -> 1.50 s ahead", () => {
    const c = comparePassingTime(300, 298.5);
    expect(c.differenceSeconds).toBe(-1.5);
    expect(c.status).toBe("ahead");
  });

  it("spec example: target 5:00.00, actual 5:00.50 -> on target", () => {
    const c = comparePassingTime(300, 300.5);
    expect(c.differenceSeconds).toBe(0.5);
    expect(c.status).toBe("on-target");
  });

  it("spec example: target 5:00.00, actual 5:02.25 -> 2.25 s behind", () => {
    const c = comparePassingTime(300, 302.25);
    expect(c.differenceSeconds).toBe(2.25);
    expect(c.status).toBe("behind");
  });

  it("difference is actual - target: negative is ahead, positive is behind", () => {
    expect(comparePassingTime(100, 90).differenceSeconds).toBe(-10);
    expect(comparePassingTime(100, 110).differenceSeconds).toBe(10);
    expect(comparePassingTime(100, 90).status).toBe("ahead");
    expect(comparePassingTime(100, 110).status).toBe("behind");
  });

  it("exactly on target", () => {
    expect(comparePassingTime(300, 300)).toEqual({ differenceSeconds: 0, status: "on-target" });
  });

  it("the tolerance edge is inclusive: exactly 1.00 s early or late is still on target", () => {
    expect(comparePassingTime(300, 301).status).toBe("on-target");
    expect(comparePassingTime(300, 299).status).toBe("on-target");
  });

  it("just outside tolerance: 1.01 s is behind/ahead", () => {
    expect(comparePassingTime(300, 301.01).status).toBe("behind");
    expect(comparePassingTime(300, 298.99).status).toBe("ahead");
  });

  it("floating-point noise can't push an exact 1.00 s over the line", () => {
    // 4.1 - 3.1 is 0.9999999999999996 in binary; 0.3 + 0.7 style sums land on 1.0000000000000002
    expect(comparePassingTime(287.99999999999994, 288.99999999999994 + 1e-13).status).toBe("on-target");
    expect(comparePassingTime(0.1 + 0.2, 0.1 + 0.2 + 1.0000000000000002).status).toBe("on-target");
  });

  it("a different tolerance can be given; 0 means any difference counts", () => {
    expect(comparePassingTime(300, 300.4, 0.5).status).toBe("on-target");
    expect(comparePassingTime(300, 300.6, 0.5).status).toBe("behind");
    expect(comparePassingTime(300, 300.0001, 0).status).toBe("behind");
    expect(comparePassingTime(300, 300, 0).status).toBe("on-target");
  });

  it("rejects non-finite times and a bad tolerance", () => {
    expect(() => comparePassingTime(NaN, 1)).toThrow(RangeError);
    expect(() => comparePassingTime(1, Infinity)).toThrow(RangeError);
    expect(() => comparePassingTime(1, 1, -1)).toThrow(RangeError);
    expect(() => comparePassingTime(1, 1, NaN)).toThrow(RangeError);
  });

  it("status labels are words, so status never relies on color", () => {
    expect(STATUS_LABEL).toEqual({ ahead: "AHEAD", "on-target": "ON TARGET", behind: "BEHIND" });
  });
});

describe("formatStopwatch: MM:SS.hh, truncated", () => {
  it.each([
    [0, "00:00.00"],
    [5.678, "00:05.67"], // truncated, not rounded
    [59.999, "00:59.99"],
    [60, "01:00.00"],
    [287.99999999999994, "04:48.00"], // floating-point noise must not read 04:47.99
    [1.15, "00:01.15"], // 1.15 * 100 is 114.99999999999999 in binary: a classic trap
    [0.29, "00:00.29"],
    [4.35, "00:04.35"],
    [3599.999, "59:59.99"],
  ])("%s s -> %s", (seconds, text) => {
    expect(formatStopwatch(seconds)).toBe(text);
  });

  it.each([
    [3600, "01:00:00.00"],
    [3723.45, "01:02:03.45"],
    [36000.5, "10:00:00.50"],
  ])("from one hour: %s s -> %s", (seconds, text) => {
    expect(formatStopwatch(seconds)).toBe(text);
  });

  it("rejects negative and non-finite input", () => {
    for (const bad of [-0.01, NaN, Infinity]) expect(() => formatStopwatch(bad)).toThrow(RangeError);
  });
});

describe("formatTargetTime (nearest) and formatActualTime (truncated)", () => {
  it.each([
    [288, "4:48.00"],
    [287.99999999999994, "4:48.00"],
    [772.496, "12:52.50"],
    [772.494, "12:52.49"],
    [0.005, "0:00.01"], // exactly half a hundredth rounds up
    [0.004999, "0:00.00"], // values are first snapped to whole microseconds
    [599.999, "10:00.00"], // the carry works: never "9:60.00"
    [3600, "1:00:00.00"],
    [4321.987, "1:12:01.99"],
  ])("target %s -> %s", (seconds, text) => {
    expect(formatTargetTime(seconds)).toBe(text);
  });

  it.each([
    [238.5, "3:58.50"],
    [599.999, "9:59.99"],
    [1195, "19:55.00"],
    [3600.009, "1:00:00.00"],
  ])("actual %s -> %s", (seconds, text) => {
    expect(formatActualTime(seconds)).toBe(text);
  });

  it("an actual time reads the same digits the stopwatch showed (apart from the leading zero)", () => {
    for (const seconds of [0.99, 61.234, 599.999, 1234.5678]) {
      expect(formatStopwatch(seconds).replace(/^0/, "")).toBe(formatActualTime(seconds));
    }
  });
});

describe("formatSignedDifference", () => {
  it.each([
    [2.25, "+2.25s"],
    [-1.5, "-1.50s"],
    [0, "0.00s"],
    [0.004, "0.00s"],
    [-0.004, "0.00s"],
    [0.005, "+0.01s"],
    [-0.005, "-0.01s"],
    [65.254, "+65.25s"],
    [119.996, "+120.00s"],
  ])("%s -> %s", (seconds, text) => {
    expect(formatSignedDifference(seconds)).toBe(text);
  });

  it("rejects non-finite input", () => {
    expect(() => formatSignedDifference(NaN)).toThrow(RangeError);
  });

  it("describeDifference gives plain words for screen readers", () => {
    expect(describeDifference(-1.5, "ahead")).toBe("1.50 seconds ahead");
    expect(describeDifference(2.25, "behind")).toBe("2.25 seconds behind");
    expect(describeDifference(0, "on-target")).toBe("exactly on target");
    expect(describeDifference(0.5, "on-target")).toBe("on target (0.50 seconds behind)");
    expect(describeDifference(-0.5, "on-target")).toBe("on target (0.50 seconds ahead)");
  });
});
