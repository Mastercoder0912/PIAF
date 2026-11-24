import { describe, expect, it } from "vitest";
import {
  calculateRace,
  resolvePacingLocations,
  type RaceCalculation,
  type DistanceUnit,
} from "../../src/engine";
import {
  INITIAL_SESSION,
  MIN_RECORD_GAP_MS,
  buildSnapshot,
  finishSummary,
  getStartBlocker,
  isComplete,
  isSessionOutdated,
  locationEditPolicy,
  needsResetConfirmation,
  nextStop,
  pauseSession,
  recordPassing,
  recordedRows,
  resetSession,
  resumeSession,
  sessionPhase,
  sessionProgress,
  startSession,
  type LiveSessionState,
  type RecordOutcome,
  type SessionSnapshot,
} from "../../src/live/session";
import { stopwatchElapsedMs } from "../../src/live/stopwatch";
import { at, unwrap } from "../helpers";

/** 5000 m in 1200 s: exactly 0.24 s per meter. Locations at 1000/2000/3500 m -> targets 240/480/840 s; finish 1200 s. */
function race(totalDistanceMeters = 5000, targetTimeSeconds = 1200): RaceCalculation {
  return unwrap(calculateRace({ totalDistanceMeters, targetTimeSeconds, intervalMode: "automatic" }));
}
type Def = { id: string; name: string; distanceMeters: number; unit?: DistanceUnit };
const DEFS: Def[] = [
  { id: "loc-3", name: "C", distanceMeters: 3500, unit: "m" },
  { id: "loc-1", name: "A", distanceMeters: 1000, unit: "m" },
  { id: "loc-2", name: "B", distanceMeters: 2000, unit: "km" },
];
const snapshotFor = (r = race(), defs: Def[] = DEFS): SessionSnapshot => buildSnapshot(r, resolvePacingLocations(defs, r));

const T0 = 10_000; // an arbitrary non-zero clock reading at Start
const at_ = (secondsIntoRun: number) => T0 + secondsIntoRun * 1000;

function started(snapshot = snapshotFor()): LiveSessionState {
  const outcome = startSession(INITIAL_SESSION, snapshot, T0);
  if (!outcome.ok) throw new Error("start refused");
  return outcome.state;
}

function recorded(state: LiveSessionState, nowMs: number, id?: string): LiveSessionState {
  const outcome: RecordOutcome = recordPassing(state, nowMs, id);
  if (!outcome.ok) throw new Error(`record refused: ${outcome.reason}`);
  return outcome.state;
}

describe("snapshot", () => {
  it("lists the locations in race order with the finish last, with targets from the engine", () => {
    const s = snapshotFor();
    expect(s.stops.map((x) => [x.id, x.name, x.distanceMeters, x.isFinish])).toEqual([
      ["loc-1", "A", 1000, false],
      ["loc-2", "B", 2000, false],
      ["loc-3", "C", 3500, false],
      ["finish", "Finish", 5000, true],
    ]);
    // pace x distance, computed on its own for each location (hand-computed: 0.24 s per meter)
    [240, 480, 840].forEach((seconds, i) => expect(at(s.stops, i).targetSeconds).toBeCloseTo(seconds, 9));
    expect(at(s.stops, 3).targetSeconds).toBe(1200); // the finish is exact, not recomputed
    expect(s.stops.map((x) => x.unit)).toEqual(["m", "km", "m", null]);
  });

  it("the finish target is the race's exact completion time", () => {
    const r = unwrap(calculateRace({ totalDistanceMeters: 5000, targetPaceSecondsPerMile: 420, intervalMode: "automatic" }));
    const s = buildSnapshot(r, resolvePacingLocations([], r));
    expect(at(s.stops, -1).targetSeconds).toBe(r.totalTimeSeconds);
  });

  it("with no stored locations the session is just the finish", () => {
    const r = race();
    expect(buildSnapshot(r, resolvePacingLocations([], r)).stops.map((x) => x.id)).toEqual(["finish"]);
  });

  it("is identical for identical setups and different when anything that matters changes", () => {
    const base = snapshotFor().key;
    expect(snapshotFor().key).toBe(base);
    expect(snapshotFor(race(5000, 1260)).key).not.toBe(base); // new target time
    expect(snapshotFor(race(4000, 960)).key).not.toBe(base); // new race
    expect(snapshotFor(race(), DEFS.slice(1)).key).not.toBe(base); // a location removed
    expect(snapshotFor(race(), [{ id: "loc-1", name: "A", distanceMeters: 1001 }, ...DEFS.slice(1)]).key).not.toBe(base);
    expect(snapshotFor(race(), DEFS.map((d) => (d.id === "loc-1" ? { ...d, name: "Renamed" } : d))).key).not.toBe(base);
  });
});

describe("starting", () => {
  it("starts the stopwatch from zero with the snapshot and no records", () => {
    const s = started();
    expect(sessionPhase(s)).toBe("running");
    expect(s.records).toEqual([]);
    expect(stopwatchElapsedMs(s.stopwatch, T0)).toBe(0);
    expect(nextStop(s)?.id).toBe("loc-1");
    expect(sessionProgress(s)).toEqual({ recorded: 0, total: 4 });
  });

  it("the initial session is idle, with no next stop", () => {
    expect(sessionPhase(INITIAL_SESSION)).toBe("idle");
    expect(nextStop(INITIAL_SESSION)).toBeNull();
    expect(recordedRows(INITIAL_SESSION)).toEqual([]);
    expect(finishSummary(INITIAL_SESSION)).toBeNull();
  });

  it("only one session at a time: starting again is refused and changes nothing", () => {
    const s = started();
    expect(startSession(s, snapshotFor(), T0 + 5)).toEqual({ ok: false, reason: "already-started" });
    expect(startSession(pauseSession(s, at_(3)), snapshotFor(), T0 + 5).ok).toBe(false);
  });
});

describe("pause and resume", () => {
  it("keeps the elapsed time and continues from it", () => {
    let s = started();
    s = pauseSession(s, at_(100));
    expect(sessionPhase(s)).toBe("paused");
    expect(stopwatchElapsedMs(s.stopwatch, at_(9999))).toBe(100_000);
    s = resumeSession(s, at_(500));
    expect(sessionPhase(s)).toBe("running");
    expect(stopwatchElapsedMs(s.stopwatch, at_(520))).toBe(120_000);
  });

  it("invalid transitions return the very same state object", () => {
    expect(pauseSession(INITIAL_SESSION, 1)).toBe(INITIAL_SESSION);
    expect(resumeSession(INITIAL_SESSION, 1)).toBe(INITIAL_SESSION);
    const s = started();
    expect(resumeSession(s, 2)).toBe(s);
    const p = pauseSession(s, at_(1));
    expect(pauseSession(p, at_(2))).toBe(p);
  });
});

describe("recording passing times", () => {
  it("captures the stopwatch's elapsed time at the instant of the press, at full precision", () => {
    const out = recordPassing(started(), T0 + 238_503.7, "loc-1");
    if (!out.ok) throw new Error(out.reason);
    expect(out.record).toEqual({ locationId: "loc-1", actualSeconds: 238.5037 });
    expect(out.stop.id).toBe("loc-1");
    expect(out.finished).toBe(false);
  });

  it("works from the stopwatch's pause/resume history, not from wall time", () => {
    let s = started();
    s = pauseSession(s, at_(100)); // 100 s banked
    s = resumeSession(s, at_(400)); // 300 s paused, not counted
    const out = recordPassing(s, at_(520), "loc-1");
    if (!out.ok) throw new Error(out.reason);
    expect(out.record.actualSeconds).toBe(220);
  });

  it("associates each time with the right location id and advances to the next", () => {
    let s = started();
    s = recorded(s, at_(238.5), "loc-1");
    expect(nextStop(s)?.id).toBe("loc-2");
    s = recorded(s, at_(480.5), "loc-2");
    expect(nextStop(s)?.id).toBe("loc-3");
    expect(s.records.map((r) => r.locationId)).toEqual(["loc-1", "loc-2"]);
    expect(sessionProgress(s)).toEqual({ recorded: 2, total: 4 });
  });

  it("records are keyed by id, so renumbering or reordering elsewhere can't misattach a time", () => {
    const s = recorded(started(), at_(238.5), "loc-1");
    const rows = recordedRows(s);
    expect(rows).toHaveLength(1);
    expect(at(rows, 0).stop.name).toBe("A");
    expect(Object.keys(at(s.records, 0)).sort()).toEqual(["actualSeconds", "locationId"]);
  });

  it("refuses a press for a location that isn't the next one (stale button)", () => {
    const s = recorded(started(), at_(238.5), "loc-1");
    expect(recordPassing(s, at_(300), "loc-1")).toEqual({ ok: false, reason: "wrong-location" });
    expect(recordPassing(s, at_(300), "finish")).toEqual({ ok: false, reason: "wrong-location" });
  });

  it("refuses an accidental double press inside the guard window; accepts one at exactly the window", () => {
    const s = recorded(started(), at_(238.5), "loc-1");
    const lastAt = at_(238.5);
    expect(recordPassing(s, lastAt + MIN_RECORD_GAP_MS - 1, "loc-2")).toEqual({ ok: false, reason: "too-soon" });
    expect(recordPassing(s, lastAt, "loc-2")).toEqual({ ok: false, reason: "too-soon" });
    expect(recordPassing(s, lastAt + MIN_RECORD_GAP_MS, "loc-2").ok).toBe(true);
  });

  it("a refused press changes nothing", () => {
    const s = recorded(started(), at_(238.5), "loc-1");
    recordPassing(s, at_(238.6), "loc-2");
    expect(s.records).toHaveLength(1);
  });

  it("cannot record unless running: not before Start, not while paused", () => {
    expect(recordPassing(INITIAL_SESSION, 5)).toEqual({ ok: false, reason: "not-running" });
    expect(recordPassing(pauseSession(started(), at_(10)), at_(20))).toEqual({ ok: false, reason: "not-running" });
  });

  it("can record immediately after start (elapsed 0)", () => {
    const out = recordPassing(started(), T0, "loc-1");
    if (!out.ok) throw new Error(out.reason);
    expect(out.record.actualSeconds).toBe(0);
  });

  it("the id check is optional", () => {
    expect(recordPassing(started(), at_(5)).ok).toBe(true);
  });
});

describe("finishing", () => {
  function finishedSession() {
    let s = started();
    s = recorded(s, at_(238.5), "loc-1"); // target 240 -> -1.5 ahead
    s = recorded(s, at_(480.5), "loc-2"); // target 480 -> +0.5 on target
    s = recorded(s, at_(842.25), "loc-3"); // target 840 -> +2.25 behind
    s = recorded(s, at_(1195), "finish"); // target 1200 -> -5 ahead
    return s;
  }

  it("recording the finish completes the session", () => {
    const s = finishedSession();
    expect(isComplete(s)).toBe(true);
    expect(sessionPhase(s)).toBe("finished");
    expect(nextStop(s)).toBeNull();
    expect(sessionProgress(s)).toEqual({ recorded: 4, total: 4 });
  });

  it("the finish is recorded like any other location, using the time at the press (not stopped first)", () => {
    let s = started();
    for (const [id, t] of [["loc-1", 100], ["loc-2", 200], ["loc-3", 300]] as const) s = recorded(s, at_(t), id);
    const out = recordPassing(s, at_(1195.123), "finish");
    if (!out.ok) throw new Error(out.reason);
    expect(out.record.actualSeconds).toBeCloseTo(1195.123, 9);
    expect(out.finished).toBe(true);
    expect(out.stop.isFinish).toBe(true);
  });

  it("then freezes the stopwatch at that same reading, so face and result agree", () => {
    const s = finishedSession();
    expect(s.stopwatch.status).toBe("paused");
    expect(stopwatchElapsedMs(s.stopwatch, at_(1195))).toBe(1_195_000);
    expect(stopwatchElapsedMs(s.stopwatch, at_(99_999))).toBe(1_195_000);
  });

  it("summarises total actual time, target, and the overall result", () => {
    const summary = finishSummary(finishedSession());
    expect(summary).toEqual({
      actualSeconds: 1195,
      targetSeconds: 1200,
      comparison: { differenceSeconds: -5, status: "ahead" },
    });
  });

  it("has no summary before the finish is recorded", () => {
    expect(finishSummary(recorded(started(), at_(238.5), "loc-1"))).toBeNull();
  });

  it("rows keep every recorded location with its own comparison", () => {
    const rows = recordedRows(finishedSession());
    expect(rows.map((r) => [r.stop.name, r.actualSeconds, r.comparison.differenceSeconds, r.comparison.status])).toEqual([
      ["A", 238.5, -1.5, "ahead"],
      ["B", 480.5, 0.5, "on-target"],
      ["C", 842.25, 2.25, "behind"],
      ["Finish", 1195, -5, "ahead"],
    ]);
    [240, 480, 840, 1200].forEach((seconds, i) => expect(at(rows, i).stop.targetSeconds).toBeCloseTo(seconds, 9));
  });

  it("after completion nothing more can be recorded, paused or resumed", () => {
    const s = finishedSession();
    expect(recordPassing(s, at_(2000))).toEqual({ ok: false, reason: "already-complete" });
    expect(pauseSession(s, at_(2000))).toBe(s);
    expect(resumeSession(s, at_(2000))).toBe(s);
    expect(startSession(s, snapshotFor(), at_(2000)).ok).toBe(false);
  });

  it("a race with no extra locations is just: start, record the finish", () => {
    const r = race();
    let s = started(buildSnapshot(r, resolvePacingLocations([], r)));
    s = recorded(s, at_(1210.04), "finish");
    expect(sessionPhase(s)).toBe("finished");
    expect(finishSummary(s)?.comparison.status).toBe("behind");
  });

  it("works for a 3 hour session", () => {
    const r = race(42195, 3 * 3600);
    let s = started(buildSnapshot(r, resolvePacingLocations([], r)));
    s = recorded(s, T0 + (3 * 3600 + 12.34) * 1000, "finish");
    expect(finishSummary(s)?.actualSeconds).toBeCloseTo(10812.34, 6);
  });
});

describe("reset and confirmation", () => {
  it("reset returns the initial state, clearing the stopwatch, snapshot and records", () => {
    expect(resetSession()).toEqual(INITIAL_SESSION);
    expect(sessionPhase(resetSession())).toBe("idle");
  });

  it("no confirmation needed when nothing has happened; needed once started or anything is recorded", () => {
    expect(needsResetConfirmation(INITIAL_SESSION)).toBe(false);
    const s = started();
    expect(needsResetConfirmation(s)).toBe(true);
    expect(needsResetConfirmation(pauseSession(s, at_(1)))).toBe(true);
    expect(needsResetConfirmation(recorded(s, at_(5), "loc-1"))).toBe(true);
  });

  it("a new session can be started after a reset", () => {
    const s = recorded(started(), at_(5), "loc-1");
    expect(startSession(s, snapshotFor(), at_(9)).ok).toBe(false);
    const again = startSession(resetSession(), snapshotFor(), at_(9));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.state.records).toEqual([]);
  });
});

describe("editing locations during a session", () => {
  it("allowed when idle", () => {
    expect(locationEditPolicy(INITIAL_SESSION)).toEqual({ allowed: true, reason: null });
  });

  it("not allowed while running, with an explanation", () => {
    const p = locationEditPolicy(started());
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/running/);
  });

  it("allowed while paused with nothing recorded", () => {
    expect(locationEditPolicy(pauseSession(started(), at_(10))).allowed).toBe(true);
  });

  it("not allowed while paused once a time is recorded: reset first, and it says resetting clears times", () => {
    const p = locationEditPolicy(pauseSession(recorded(started(), at_(5), "loc-1"), at_(10)));
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/Reset/);
    expect(p.reason).toMatch(/clears the recorded times/);
  });

  it("not allowed once finished", () => {
    let s = started(buildSnapshot(race(), resolvePacingLocations([], race())));
    s = recorded(s, at_(5), "finish");
    expect(locationEditPolicy(s).allowed).toBe(false);
  });

  it("allowed again after reset", () => {
    expect(locationEditPolicy(resetSession()).allowed).toBe(true);
  });
});

describe("detecting a changed setup (stale targets)", () => {
  it("is not outdated while the live setup matches the snapshot", () => {
    const s = started();
    expect(isSessionOutdated(s, snapshotFor().key)).toBe(false);
  });

  it("is outdated when the race changes, a location changes, or there is no race any more", () => {
    const s = started();
    expect(isSessionOutdated(s, snapshotFor(race(5000, 1260)).key)).toBe(true);
    expect(isSessionOutdated(s, snapshotFor(race(), DEFS.slice(1)).key)).toBe(true);
    expect(isSessionOutdated(s, null)).toBe(true);
  });

  it("an idle session has nothing to be outdated against", () => {
    expect(isSessionOutdated(INITIAL_SESSION, null)).toBe(false);
    expect(isSessionOutdated(INITIAL_SESSION, "anything")).toBe(false);
  });

  it("a running session keeps its ORIGINAL targets: later setup changes can't reach it", () => {
    const s = started();
    const changed = snapshotFor(race(5000, 1260)); // the live setup moves to 21:00
    expect(changed.stops.map((x) => x.targetSeconds)).not.toEqual(s.snapshot?.stops.map((x) => x.targetSeconds));
    const after = recorded(s, at_(238.5), "loc-1");
    expect(at(recordedRows(after), 0).stop.targetSeconds).toBe(240); // not 252
    expect(after.snapshot).toBe(s.snapshot);
  });
});

describe("blocking a new session", () => {
  it("allows it when there's a race, the inputs are current, and every location fits", () => {
    expect(getStartBlocker({ hasRace: true, isStale: false, needsAttentionCount: 0 })).toBeNull();
  });

  it("explains each reason", () => {
    expect(getStartBlocker({ hasRace: false, isStale: false, needsAttentionCount: 0 })?.code).toBe("no-race");
    expect(getStartBlocker({ hasRace: true, isStale: true, needsAttentionCount: 0 })?.code).toBe("stale-inputs");
    const one = getStartBlocker({ hasRace: true, isStale: false, needsAttentionCount: 1 });
    expect(one?.code).toBe("needs-attention");
    expect(one?.message).toMatch(/1 pacing location doesn't fit/);
    expect(getStartBlocker({ hasRace: true, isStale: false, needsAttentionCount: 3 })?.message).toMatch(/3 pacing locations don't fit/);
  });

  it("no race takes priority over the others", () => {
    expect(getStartBlocker({ hasRace: false, isStale: true, needsAttentionCount: 2 })?.code).toBe("no-race");
  });
});

describe("purity", () => {
  it("actions never mutate the state they are given", () => {
    const s = started();
    const frozen = JSON.stringify(s);
    pauseSession(s, at_(5));
    recordPassing(s, at_(5), "loc-1");
    resumeSession(s, at_(5));
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
