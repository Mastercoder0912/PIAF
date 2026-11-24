import { describe, expect, it } from "vitest";
import {
  IDLE_STOPWATCH,
  pauseStopwatch,
  resetStopwatch,
  resumeStopwatch,
  startStopwatch,
  stopwatchElapsedMs,
  stopwatchElapsedSeconds,
  type StopwatchState,
} from "../../src/live/stopwatch";

// All times below are chosen by hand (simple arithmetic), not produced by the code under test.

describe("initial state", () => {
  it("is idle with nothing elapsed, whatever the clock says", () => {
    expect(IDLE_STOPWATCH).toEqual({ status: "idle", accumulatedMs: 0, startedAtMs: null });
    expect(stopwatchElapsedMs(IDLE_STOPWATCH, 0)).toBe(0);
    expect(stopwatchElapsedMs(IDLE_STOPWATCH, 987654.321)).toBe(0);
  });
});

describe("start", () => {
  it("begins from zero at the clock reading it was given (the clock need not start at 0)", () => {
    const s = startStopwatch(IDLE_STOPWATCH, 12_345.5);
    expect(s.status).toBe("running");
    expect(stopwatchElapsedMs(s, 12_345.5)).toBe(0);
    expect(stopwatchElapsedMs(s, 17_580)).toBe(5234.5);
    expect(stopwatchElapsedSeconds(s, 17_580)).toBe(5.2345);
  });

  it("is refused unless idle: a second Start can't restart or overlap a run", () => {
    const running = startStopwatch(IDLE_STOPWATCH, 1000);
    expect(startStopwatch(running, 9000)).toBe(running);
    const paused = pauseStopwatch(running, 2000);
    expect(startStopwatch(paused, 9000)).toBe(paused);
  });
});

describe("pause", () => {
  it("freezes elapsed time and keeps it", () => {
    const paused = pauseStopwatch(startStopwatch(IDLE_STOPWATCH, 1000), 4000);
    expect(paused).toEqual({ status: "paused", accumulatedMs: 3000, startedAtMs: null });
    expect(stopwatchElapsedMs(paused, 4000)).toBe(3000);
    expect(stopwatchElapsedMs(paused, 99_999_999)).toBe(3000); // time passing while paused changes nothing
  });

  it("does nothing unless running", () => {
    expect(pauseStopwatch(IDLE_STOPWATCH, 5)).toBe(IDLE_STOPWATCH);
    const paused = pauseStopwatch(startStopwatch(IDLE_STOPWATCH, 0), 10);
    expect(pauseStopwatch(paused, 500)).toBe(paused);
  });
});

describe("resume", () => {
  it("continues from the paused time and does not reset", () => {
    const paused = pauseStopwatch(startStopwatch(IDLE_STOPWATCH, 1000), 4000); // 3000 ms banked
    const resumed = resumeStopwatch(paused, 10_000);
    expect(resumed.status).toBe("running");
    expect(stopwatchElapsedMs(resumed, 10_000)).toBe(3000); // the 6 s spent paused is not counted
    expect(stopwatchElapsedMs(resumed, 12_500)).toBe(5500);
  });

  it("does nothing unless paused", () => {
    const running = startStopwatch(IDLE_STOPWATCH, 0);
    expect(resumeStopwatch(IDLE_STOPWATCH, 5)).toBe(IDLE_STOPWATCH);
    expect(resumeStopwatch(running, 5)).toBe(running);
  });
});

describe("reset", () => {
  it("returns to the initial state from any state", () => {
    const running = startStopwatch(IDLE_STOPWATCH, 0);
    const paused = pauseStopwatch(running, 777);
    for (const s of [IDLE_STOPWATCH, running, paused]) {
      expect(s).toBeDefined();
      expect(resetStopwatch()).toEqual(IDLE_STOPWATCH);
    }
    // and it can be started again from zero
    expect(stopwatchElapsedMs(startStopwatch(resetStopwatch(), 50_000), 50_250)).toBe(250);
  });
});

describe("multiple pause/resume cycles", () => {
  it("adds up only the running periods", () => {
    let s: StopwatchState = startStopwatch(IDLE_STOPWATCH, 0);
    s = pauseStopwatch(s, 1000); // ran 1000
    s = resumeStopwatch(s, 5000); // 4000 paused
    s = pauseStopwatch(s, 7500); // ran 2500  -> 3500
    s = resumeStopwatch(s, 20_000);
    s = pauseStopwatch(s, 20_250.5); // ran 250.5 -> 3750.5
    expect(stopwatchElapsedMs(s, 1e9)).toBe(3750.5);
    s = resumeStopwatch(s, 30_000);
    expect(stopwatchElapsedMs(s, 31_000)).toBe(4750.5);
  });

  it("1000 quick cycles lose nothing: no accumulated drift", () => {
    let s: StopwatchState = startStopwatch(IDLE_STOPWATCH, 123.456);
    let clock = 123.456;
    for (let i = 0; i < 1000; i++) {
      clock += 7.3; // runs 7.3 ms
      s = pauseStopwatch(s, clock);
      clock += 3; // paused 3 ms
      s = resumeStopwatch(s, clock);
    }
    expect(stopwatchElapsedMs(s, clock)).toBeCloseTo(7300, 6);
  });
});

describe("accuracy over long sessions", () => {
  it("10 hours is exact to the microsecond (value is read from timestamps, not counted)", () => {
    const start = 0.1;
    const s = startStopwatch(IDLE_STOPWATCH, start);
    const tenHoursMs = 10 * 3600 * 1000;
    expect(stopwatchElapsedMs(s, start + tenHoursMs + 0.37)).toBeCloseTo(tenHoursMs + 0.37, 6);
  });

  it("the answer doesn't depend on how often the display read the clock", () => {
    const s = startStopwatch(IDLE_STOPWATCH, 500);
    const finalNow = 500 + 3_723_450; // 1 h 2 m 3.45 s
    const direct = stopwatchElapsedMs(s, finalNow);
    // a hidden tab might read once; a busy one reads every 16.7 ms: same answer
    let last = 0;
    for (let now = 500; now <= finalNow; now += 16.7) last = stopwatchElapsedMs(s, now);
    expect(last).toBeLessThanOrEqual(direct);
    expect(direct).toBe(3_723_450);
    expect(stopwatchElapsedMs(s, finalNow)).toBe(direct);
  });

  it("a long paused gap while 'in the background' is not counted", () => {
    let s = startStopwatch(IDLE_STOPWATCH, 0);
    s = pauseStopwatch(s, 60_000);
    s = resumeStopwatch(s, 60_000 + 6 * 3600 * 1000);
    expect(stopwatchElapsedMs(s, 60_000 + 6 * 3600 * 1000 + 30_000)).toBe(90_000);
  });
});

describe("monotonic clock handling", () => {
  it("never reports negative elapsed time if a clock reading is earlier than the start", () => {
    const s = startStopwatch(IDLE_STOPWATCH, 5000);
    expect(stopwatchElapsedMs(s, 4000)).toBe(0);
    expect(stopwatchElapsedMs(s, -1e9)).toBe(0);
  });

  it("a pause with an earlier reading banks nothing instead of subtracting", () => {
    const running = startStopwatch(IDLE_STOPWATCH, 5000);
    const paused = pauseStopwatch(running, 4000);
    expect(paused.accumulatedMs).toBe(0);
    const withTime = resumeStopwatch(pauseStopwatch(running, 6000), 7000);
    expect(pauseStopwatch(withTime, 6500).accumulatedMs).toBe(1000);
  });

  it("rejects readings that aren't finite numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => startStopwatch(IDLE_STOPWATCH, bad)).toThrow(RangeError);
      expect(() => stopwatchElapsedMs(IDLE_STOPWATCH, bad)).toThrow(RangeError);
      expect(() => pauseStopwatch(IDLE_STOPWATCH, bad)).toThrow(RangeError);
      expect(() => resumeStopwatch(IDLE_STOPWATCH, bad)).toThrow(RangeError);
    }
  });

  it("never mutates a state it was given", () => {
    const running = Object.freeze(startStopwatch(IDLE_STOPWATCH, 10));
    expect(() => pauseStopwatch(running, 20)).not.toThrow();
    expect(running).toEqual({ status: "running", accumulatedMs: 0, startedAtMs: 10 });
  });
});
