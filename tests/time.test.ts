import { describe, expect, it } from "vitest";
import { formatDuration, parsePaceString, parseTimeString } from "../src/engine/time";
import { errorCodes, unwrap } from "./helpers";

describe("parseTimeString: valid input", () => {
  it.each([
    ["0:00", 0],
    ["0:59", 59],
    ["5:00", 300],
    ["19:45", 1185],
    ["75:00", 4500], // MM:SS minutes may exceed 59
    ["1:05:30", 3930],
    ["0:00:01", 1],
    ["2:59:59", 10799],
    ["  19:45  ", 1185], // surrounding whitespace is ignored
  ])("parses %s as %d seconds", (text, seconds) => {
    expect(unwrap(parseTimeString(text))).toBe(seconds);
  });

  it("accepts a decimal part on the seconds", () => {
    expect(unwrap(parseTimeString("19:45.3"))).toBeCloseTo(1185.3, 9);
    expect(unwrap(parseTimeString("0:59.99"))).toBeCloseTo(59.99, 9);
    expect(unwrap(parseTimeString("1:00:00.5"))).toBeCloseTo(3600.5, 9);
  });
});

describe("parseTimeString: invalid input", () => {
  it.each([
    ["empty string", ""],
    ["only spaces", "   "],
    ["words", "abc"],
    ["no colon", "5"],
    ["only a colon", ":"],
    ["too many parts", "1:2:3:4"],
    ["seconds = 60", "5:60"],
    ["seconds = 75", "5:75"],
    ["seconds = 60 with hours", "1:00:60"],
    ["minutes = 60 with hours", "1:60:00"],
    ["minutes = 75 with hours", "1:75:00"],
    ["one-digit seconds", "5:7"],
    ["one-digit minutes with hours", "1:5:30"],
    ["negative minutes", "-5:00"],
    ["trailing colon", "5:00:"],
    ["leading colon", ":30"],
    ["fractional minutes", "1.5:30"],
    ["letters in seconds", "5:3a"],
    ["decimal with no digits", "5:30."],
    ["comma decimal", "5:30,5"],
    ["too many digits", "12345678:00"],
  ])("rejects %s", (_name, text) => {
    const result = parseTimeString(text);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toEqual(["INVALID_TIME_FORMAT"]);
  });

  it("explains why seconds >= 60 are rejected", () => {
    const result = parseTimeString("5:60");
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.message).toMatch(/less than 60/i);
  });

  it("rejects non-string input without throwing", () => {
    expect(parseTimeString(null as unknown as string).ok).toBe(false);
    expect(parseTimeString(undefined as unknown as string).ok).toBe(false);
    expect(parseTimeString(330 as unknown as string).ok).toBe(false);
  });

  it("tags errors with the field name it was given", () => {
    const result = parseTimeString("nope", "targetTime");
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.field).toBe("targetTime");
  });
});

describe("parsePaceString", () => {
  it("reads MM:SS as minutes and seconds per mile", () => {
    expect(unwrap(parsePaceString("6:30"))).toBe(390);
    expect(unwrap(parsePaceString("5:00"))).toBe(300);
    expect(unwrap(parsePaceString("12:05"))).toBe(725);
    expect(unwrap(parsePaceString("6:26.2"))).toBeCloseTo(386.2, 9);
  });

  it.each(["", "6", "6:60", "abc", "0:00", "1:05:00", "-6:30", "6:3"])("rejects %j", (text) => {
    const result = parsePaceString(text);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toEqual(["INVALID_PACE"]);
  });

  it("gives the coach a usable hint", () => {
    const result = parsePaceString("1:05:00");
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.message).toMatch(/MM:SS per mile/);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [386.24256, "6:26"],
    [1200, "20:00"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3930, "1:05:30"],
    [36000, "10:00:00"],
  ])("formats %d s as %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it("rounds only at display time, once, with correct carry", () => {
    expect(formatDuration(119.6)).toBe("2:00"); // not "1:60"
    expect(formatDuration(3599.6)).toBe("1:00:00"); // not "59:60"
    expect(formatDuration(59.96, 1)).toBe("1:00.0");
    expect(formatDuration(3599.999, 2)).toBe("1:00:00.00");
  });

  it("supports fractional seconds", () => {
    expect(formatDuration(357.9098, 1)).toBe("5:57.9");
    expect(formatDuration(357.9098, 2)).toBe("5:57.91");
    expect(formatDuration(0.05, 2)).toBe("0:00.05");
    expect(formatDuration(3930.5, 1)).toBe("1:05:30.5");
  });

  it("does not modify its input", () => {
    const seconds = 357.9098;
    formatDuration(seconds, 1);
    expect(seconds).toBe(357.9098);
  });

  it("throws RangeError on invalid input", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
    expect(() => formatDuration(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatDuration(10, 4)).toThrow(RangeError);
    expect(() => formatDuration(10, -1)).toThrow(RangeError);
    expect(() => formatDuration(10, 1.5)).toThrow(RangeError);
  });
});

describe("parse/format round trip", () => {
  it("format(parse(text)) returns the original text for canonical inputs", () => {
    for (const text of ["0:00", "0:59", "6:30", "19:45", "59:59", "1:00:00", "1:05:30", "2:59:59"]) {
      expect(formatDuration(unwrap(parseTimeString(text)))).toBe(text);
    }
  });

  it("parse(format(seconds)) returns the original whole seconds", () => {
    for (let seconds = 0; seconds < 20000; seconds += 37) {
      expect(unwrap(parseTimeString(formatDuration(seconds)))).toBe(seconds);
    }
  });
});
