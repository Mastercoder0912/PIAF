import { describe, expect, it } from "vitest";
import { METERS_PER_MILE, parsePaceString, parseTimeString } from "../../src/engine";
import { formatTenths } from "../../src/display";
import { runCalculation, type CalcOutcome } from "../../src/state/calculate";
import {
  INITIAL_FORM,
  formReducer,
  hasMeaningfulChanges,
  switchTargetMode,
  type FormState,
} from "../../src/state/form";
import { at } from "../helpers";

const form = (overrides: Partial<FormState>): FormState => ({ ...INITIAL_FORM, ...overrides });

function ok(outcome: CalcOutcome) {
  if (!outcome.ok) throw new Error(`Expected success, got: ${JSON.stringify(outcome.errors)}`);
  return outcome;
}

function errorsOf(outcome: CalcOutcome) {
  if (outcome.ok) throw new Error("Expected validation errors, got a calculation");
  return outcome.errors;
}

describe("required scenario: 5K in 20:00", () => {
  const outcome = ok(
    runCalculation(form({ distanceText: "5", distanceUnit: "km", targetMode: "time", timeText: "20:00" })),
  );

  it("converts 5 km to 5000 m and resolves pace 386.24256 s/mile", () => {
    expect(outcome.config.totalDistanceMeters).toBe(5000);
    expect(outcome.calculation.paceSecondsPerMile).toBeCloseTo(386.24256, 9);
    expect(outcome.calculation.totalTimeSeconds).toBe(1200);
    expect(formatTenths(outcome.calculation.paceSecondsPerMile)).toBe("6:26.2");
  });

  it("builds the automatic split list ending in the finish", () => {
    const { splits } = outcome.calculation;
    // a 5K is longer than a mile, so: mile markers 1, 2, 3, then the finish
    expect(splits).toHaveLength(4);
    [1609.344, 3218.688, 4828.032].forEach((meters, i) => expect(at(splits, i).distanceMeters).toBeCloseTo(meters, 9));
    expect(at(splits, -1).isFinish).toBe(true);
    expect(at(splits, -1).distanceMeters).toBe(5000);
  });
});

describe("required scenario: 5K at 7:00/mile", () => {
  const outcome = ok(
    runCalculation(form({ distanceText: "5", distanceUnit: "km", targetMode: "pace", paceText: "7:00" })),
  );

  it("resolves total time 1304.8795 s", () => {
    expect(outcome.calculation.paceSecondsPerMile).toBe(420);
    expect(Math.abs(outcome.calculation.totalTimeSeconds - 1304.8795)).toBeLessThan(5e-5);
    expect(formatTenths(outcome.calculation.totalTimeSeconds)).toBe("21:44.9");
  });
});

describe("required scenario: 1600 m versus one mile", () => {
  const pace = { targetMode: "pace" as const, paceText: "6:00" };

  it("1600 m finishes at 1600 m with no mile marker", () => {
    const { calculation } = ok(runCalculation(form({ distanceText: "1600", distanceUnit: "m", ...pace })));
    const { splits } = calculation;
    expect(at(splits, -1).distanceMeters).toBe(1600);
    expect(at(splits, -1).isFinish).toBe(true);
    expect(splits.some((s) => Math.abs(s.distanceMeters - METERS_PER_MILE) < 1e-6)).toBe(false);
    expect(formatTenths(calculation.totalTimeSeconds)).toBe("5:57.9");
  });

  it("1 mile finishes at 1609.344 m with 400 m splits and no 1600 m split", () => {
    const { calculation } = ok(runCalculation(form({ distanceText: "1", distanceUnit: "mi", ...pace })));
    const { splits } = calculation;
    expect(at(splits, -1).distanceMeters).toBeCloseTo(1609.344, 9);
    expect(at(splits, -1).isFinish).toBe(true);
    expect(splits.map((s) => s.distanceMeters)).toEqual([400, 800, 1200, at(splits, -1).distanceMeters]);
    expect(splits.some((s) => s.distanceMeters === 1600)).toBe(false);
    expect(formatTenths(calculation.totalTimeSeconds)).toBe("6:00.0");
  });
});

describe("interval selection", () => {
  const base = form({ distanceText: "5", distanceUnit: "km", timeText: "20:00" });

  it("automatic mode ignores any text left in the manual interval box", () => {
    const withText = ok(runCalculation({ ...base, intervalMode: "automatic", intervalText: "777" }));
    const without = ok(runCalculation(base));
    expect(withText.calculation.splits).toEqual(without.calculation.splits);
  });

  it("manual 400 m on a 5K gives 12 markers plus the finish", () => {
    const { calculation } = ok(
      runCalculation({ ...base, intervalMode: "manual", intervalText: "400", intervalUnit: "m" }),
    );
    expect(calculation.splits).toHaveLength(13);
    expect(at(calculation.splits, 0).distanceMeters).toBe(400);
    expect(at(calculation.splits, -1).isFinish).toBe(true);
  });

  it("converts the manual interval from kilometers and miles to meters", () => {
    const km = ok(runCalculation({ ...base, intervalMode: "manual", intervalText: "1", intervalUnit: "km" }));
    expect(km.config.intervalDistanceMeters).toBe(1000);
    expect(km.calculation.splits.map((s) => s.distanceMeters)).toEqual([1000, 2000, 3000, 4000, 5000]);

    const mi = ok(runCalculation({ ...base, intervalMode: "manual", intervalText: "1", intervalUnit: "mi" }));
    expect(mi.config.intervalDistanceMeters).toBeCloseTo(1609.344, 9);
    expect(mi.calculation.splits).toHaveLength(4); // 1, 2, 3 miles + finish
  });

  it("accepts decimal intervals", () => {
    const { config } = ok(
      runCalculation({ ...base, intervalMode: "manual", intervalText: "0.5", intervalUnit: "km" }),
    );
    expect(config.intervalDistanceMeters).toBe(500);
  });
});

describe("invalid input", () => {
  it("an empty form reports the distance and the target time", () => {
    const errors = errorsOf(runCalculation(INITIAL_FORM));
    expect(errors.distance).toEqual(["Enter a race distance."]);
    expect(errors.time?.[0]).toMatch(/MM:SS or HH:MM:SS/);
    expect(errors.pace).toBeUndefined();
  });

  it("reports every bad field at once", () => {
    const errors = errorsOf(
      runCalculation(
        form({ distanceText: "abc", timeText: "20:75", intervalMode: "manual", intervalText: "" }),
      ),
    );
    expect(Object.keys(errors).sort()).toEqual(["distance", "interval", "time"]);
  });

  it.each([
    ["not a number", "abc"],
    ["two decimal points", "1.2.3"],
    ["a comma decimal", "1,5"],
    ["an exponent", "1e3"],
  ])("rejects a distance that is %s", (_name, text) => {
    expect(errorsOf(runCalculation(form({ distanceText: text, timeText: "20:00" }))).distance?.[0]).toMatch(
      /must be a number/,
    );
  });

  it.each(["0", "-5"])("uses the engine's message for a distance of %s", (text) => {
    expect(errorsOf(runCalculation(form({ distanceText: text, timeText: "20:00" }))).distance).toEqual([
      "Distance must be a number greater than 0.",
    ]);
  });

  it("rejects seconds of 60 or more in a time", () => {
    const errors = errorsOf(runCalculation(form({ distanceText: "5", timeText: "20:60" })));
    expect(errors.time?.[0]).toMatch(/less than 60/);
  });

  it("rejects a time of 0:00 via the engine and attaches it to the time field", () => {
    const errors = errorsOf(runCalculation(form({ distanceText: "5", timeText: "0:00" })));
    expect(errors.time).toEqual(["Target time must be greater than 0 seconds."]);
  });

  it("rejects bad paces, including HH:MM:SS and 0:00", () => {
    for (const paceText of ["", "7", "7:60", "1:05:00", "0:00", "fast"]) {
      const errors = errorsOf(
        runCalculation(form({ distanceText: "5", targetMode: "pace", paceText })),
      );
      expect(errors.pace?.length).toBeGreaterThan(0);
      expect(errors.time).toBeUndefined();
    }
  });

  it("only validates the visible target: a bad hidden time doesn't block a pace calculation", () => {
    const outcome = runCalculation(
      form({ distanceText: "5", targetMode: "pace", paceText: "7:00", timeText: "garbage" }),
    );
    expect(outcome.ok).toBe(true);
  });

  it("manual mode requires an interval and routes engine wording to the interval field", () => {
    const base = form({ distanceText: "5", timeText: "20:00", intervalMode: "manual" });
    expect(errorsOf(runCalculation({ ...base, intervalText: "" })).interval).toEqual([
      "Enter an interval distance.",
    ]);
    expect(errorsOf(runCalculation({ ...base, intervalText: "0" })).interval?.[0]).toMatch(
      /greater than 0/,
    );
    expect(errorsOf(runCalculation({ ...base, intervalText: "-100" })).interval?.[0]).toMatch(
      /greater than 0/,
    );
    expect(errorsOf(runCalculation({ ...base, intervalText: "x" })).interval?.[0]).toMatch(
      /must be a number/,
    );
  });

  it("refuses an interval that would create too many splits", () => {
    const errors = errorsOf(
      runCalculation(
        form({ distanceText: "10", timeText: "40:00", intervalMode: "manual", intervalText: "0.001" }),
      ),
    );
    expect(errors.interval?.[0]).toMatch(/maximum/);
  });

  it("every error message is plain English, never undefined/NaN", () => {
    const errors = errorsOf(runCalculation(form({ distanceText: "-1", timeText: "99:99" })));
    for (const messages of Object.values(errors)) {
      for (const message of messages ?? []) expect(message).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});

describe("switching between target time and target pace", () => {
  const timeForm = form({ distanceText: "5", distanceUnit: "km", timeText: "20:00" });

  it("time -> pace pre-fills the equivalent pace and marks it as converted", () => {
    const next = switchTargetMode(timeForm, "pace");
    expect(next.targetMode).toBe("pace");
    expect(next.paceText).toBe("6:26.243");
    expect(next.paceDerived).toBe(true);
    expect(next.timeText).toBe("20:00"); // the original is kept
  });

  it("pace -> time pre-fills the equivalent time", () => {
    const next = switchTargetMode(
      form({ distanceText: "5", distanceUnit: "km", targetMode: "pace", paceText: "7:00" }),
      "time",
    );
    expect(next.timeText).toBe("21:44.880");
    expect(next.timeDerived).toBe(true);
    expect(next.paceText).toBe("7:00");
  });

  it("converted values survive a round trip without visibly drifting", () => {
    const viaPace = switchTargetMode(timeForm, "pace");
    const outcome = ok(runCalculation(viaPace));
    expect(formatTenths(outcome.calculation.totalTimeSeconds)).toBe("20:00.0");

    const marathon = switchTargetMode(
      form({ distanceText: "42.195", distanceUnit: "km", timeText: "3:00:00" }),
      "pace",
    );
    expect(formatTenths(ok(runCalculation(marathon)).calculation.totalTimeSeconds)).toBe("3:00:00.0");
  });

  it("the pre-filled text is always readable by the parsers", () => {
    expect(parsePaceString(switchTargetMode(timeForm, "pace").paceText).ok).toBe(true);
    const pace = form({ distanceText: "5", targetMode: "pace", paceText: "7:00" });
    expect(parseTimeString(switchTargetMode(pace, "time").timeText).ok).toBe(true);
  });

  it("never overwrites a value the coach typed in the other field", () => {
    const typed = { ...timeForm, paceText: "8:00" };
    const next = switchTargetMode(typed, "pace");
    expect(next.paceText).toBe("8:00");
    expect(next.paceDerived).toBe(false);
  });

  it("refreshes a previously converted value when the inputs have changed", () => {
    const first = switchTargetMode(timeForm, "pace");
    const back = switchTargetMode(first, "time");
    const changed = { ...back, timeText: "25:00" };
    const again = switchTargetMode(changed, "pace");
    // 25:00 = 1500 s over 5000 m: 1500 * 1609.344 / 5000 = 482.8032 s/mile
    expect(again.paceText).toBe("8:02.803");
  });

  it("typing into a converted field makes it the coach's own value", () => {
    const converted = switchTargetMode(timeForm, "pace");
    const edited = formReducer(converted, { type: "editText", field: "paceText", value: "6:30" });
    expect(edited.paceDerived).toBe(false);
    expect(switchTargetMode(switchTargetMode(edited, "time"), "pace").paceText).toBe("6:30");
  });

  it("changes only the mode when the current inputs can't be converted", () => {
    for (const bad of [
      { ...timeForm, distanceText: "" },
      { ...timeForm, distanceText: "abc" },
      { ...timeForm, timeText: "" },
      { ...timeForm, timeText: "20:75" },
      { ...timeForm, timeText: "0:00" },
    ]) {
      const next = switchTargetMode(bad, "pace");
      expect(next).toEqual({ ...bad, targetMode: "pace" });
    }
  });

  it("doesn't pre-fill a pace the pace field couldn't accept", () => {
    // 100 m in 10:00 is far over an hour per mile.
    const next = switchTargetMode(form({ distanceText: "100", distanceUnit: "m", timeText: "10:00" }), "pace");
    expect(next.paceText).toBe("");
    expect(next.paceDerived).toBe(false);
  });

  it("switching to the mode you're already in is a no-op", () => {
    expect(switchTargetMode(timeForm, "time")).toBe(timeForm);
  });
});

describe("reset helpers", () => {
  it("reset returns exactly the initial form", () => {
    const dirty = form({
      distanceText: "5",
      distanceUnit: "mi",
      targetMode: "pace",
      paceText: "7:00",
      intervalMode: "manual",
      intervalText: "400",
      intervalUnit: "km",
    });
    expect(formReducer(dirty, { type: "reset" })).toEqual(INITIAL_FORM);
  });

  it("only typed values count as meaningful changes", () => {
    expect(hasMeaningfulChanges(INITIAL_FORM)).toBe(false);
    expect(hasMeaningfulChanges(form({ distanceUnit: "mi", targetMode: "pace", intervalMode: "manual" }))).toBe(false);
    expect(hasMeaningfulChanges(form({ distanceText: "   " }))).toBe(false);
    expect(hasMeaningfulChanges(form({ distanceText: "5" }))).toBe(true);
    expect(hasMeaningfulChanges(form({ timeText: "20:00" }))).toBe(true);
    expect(hasMeaningfulChanges(form({ paceText: "7:00" }))).toBe(true);
    expect(hasMeaningfulChanges(form({ intervalText: "400" }))).toBe(true);
  });
});
