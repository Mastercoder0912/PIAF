import type { DistanceUnit, PacingLocationDefinition, RaceTiming, ResolvedPacingLocations } from "../engine";
import { comparePassingTime, type PassingComparison } from "./comparison";
import {
  IDLE_STOPWATCH,
  pauseStopwatch,
  resumeStopwatch,
  startStopwatch,
  stopwatchElapsedMs,
  type StopwatchState,
} from "./stopwatch";

/**
 * A live race session: a stopwatch, a frozen copy ("snapshot") of the race and its
 * pacing locations, and the passing times recorded so far.
 *
 * Pure functions only (no React, no timers). Every action that depends on time takes
 * the clock reading `nowMs` as an argument, so the caller reads the clock the instant
 * a button is pressed and tests can use any clock they like.
 *
 * Why a snapshot: targets are derived from the calculator's race, and locations are
 * edited elsewhere. If a session read those live, changing the calculator mid-race
 * would silently move the targets under times already recorded. The snapshot is taken
 * once, when the stopwatch starts, and never changes.
 */

/** Two Record presses closer than this are treated as one accidental double-tap. */
export const MIN_RECORD_GAP_MS = 500;

export interface SessionStop {
  /** Stable pacing-location id (never an array index). The finish uses "finish". */
  id: string;
  name: string;
  distanceMeters: number;
  /** Unit the coach entered it in; null for the automatic finish. */
  unit: DistanceUnit | null;
  /** Target passing time in seconds, full precision, frozen at session start. */
  targetSeconds: number;
  isFinish: boolean;
}

export interface SessionSnapshot {
  race: RaceTiming;
  /** In race order. The finish is always last. */
  stops: SessionStop[];
  /** Fingerprint of the race and every stop, used to detect that the live setup has since changed. */
  key: string;
}

export interface PassingRecord {
  /** Which pacing location this belongs to, by id. */
  locationId: string;
  /** Elapsed stopwatch time when Record was pressed, in seconds, full precision. */
  actualSeconds: number;
}

export interface LiveSessionState {
  stopwatch: StopwatchState;
  snapshot: SessionSnapshot | null;
  /** In the order recorded, which is race order (each press records the next location). */
  records: PassingRecord[];
  /** Clock reading of the last accepted Record press, for the double-tap guard. */
  lastRecordAtMs: number | null;
}

export const INITIAL_SESSION: LiveSessionState = {
  stopwatch: IDLE_STOPWATCH,
  snapshot: null,
  records: [],
  lastRecordAtMs: null,
};

export type SessionPhase = "idle" | "running" | "paused" | "finished";

// ---------------------------------------------------------------- snapshot

type SnapshotLocation = PacingLocationDefinition & { unit?: DistanceUnit };

/** The configuration a session would start with right now: the race, its valid locations, and the finish. */
export function buildSnapshot(race: RaceTiming, resolved: ResolvedPacingLocations<SnapshotLocation>): SessionSnapshot {
  const stops: SessionStop[] = [
    ...resolved.locations.map(
      (location): SessionStop => ({
        id: location.id,
        name: location.name,
        distanceMeters: location.distanceMeters,
        unit: location.unit ?? null,
        targetSeconds: location.targetTimeSeconds,
        isFinish: false,
      }),
    ),
    {
      id: resolved.finish.id,
      name: resolved.finish.name,
      distanceMeters: resolved.finish.distanceMeters,
      unit: null,
      targetSeconds: resolved.finish.targetTimeSeconds,
      isFinish: true,
    },
  ];
  const raceTiming: RaceTiming = {
    totalDistanceMeters: race.totalDistanceMeters,
    totalTimeSeconds: race.totalTimeSeconds,
    paceSecondsPerMile: race.paceSecondsPerMile,
  };
  const key = JSON.stringify([
    raceTiming.totalDistanceMeters,
    raceTiming.totalTimeSeconds,
    raceTiming.paceSecondsPerMile,
    stops.map((s) => [s.id, s.name, s.distanceMeters, s.targetSeconds]),
  ]);
  return { race: raceTiming, stops, key };
}

/** True when the live setup (null = no race right now) no longer matches what the session started with. */
export function isSessionOutdated(state: LiveSessionState, currentKey: string | null): boolean {
  if (state.snapshot === null) return false;
  return currentKey !== state.snapshot.key;
}

export type StartBlockerCode = "no-race" | "stale-inputs" | "needs-attention";

export interface StartBlocker {
  code: StartBlockerCode;
  message: string;
}

/** Why a new session can't start yet, or null if it can. */
export function getStartBlocker(input: {
  hasRace: boolean;
  isStale: boolean;
  needsAttentionCount: number;
}): StartBlocker | null {
  if (!input.hasRace) {
    return { code: "no-race", message: "Calculate a race in the Calculator before starting a live session." };
  }
  if (input.isStale) {
    return {
      code: "stale-inputs",
      message: "The calculator inputs have changed since the race was calculated. Recalculate so the targets match what you see.",
    };
  }
  if (input.needsAttentionCount > 0) {
    return {
      code: "needs-attention",
      message: `${input.needsAttentionCount} pacing ${input.needsAttentionCount === 1 ? "location doesn't" : "locations don't"} fit the current race. Fix or delete ${input.needsAttentionCount === 1 ? "it" : "them"} in Locations before starting.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------- phase and progress

export function sessionPhase(state: LiveSessionState): SessionPhase {
  if (state.stopwatch.status === "idle") return "idle";
  if (isComplete(state)) return "finished";
  return state.stopwatch.status;
}

export function isComplete(state: LiveSessionState): boolean {
  const { snapshot } = state;
  if (snapshot === null || snapshot.stops.length === 0) return false;
  return state.records.length >= snapshot.stops.length;
}

/** The next location to record, or null (not started, or every location recorded). */
export function nextStop(state: LiveSessionState): SessionStop | null {
  const { snapshot } = state;
  if (snapshot === null) return null;
  const recorded = new Set(state.records.map((r) => r.locationId));
  return snapshot.stops.find((stop) => !recorded.has(stop.id)) ?? null;
}

export function sessionProgress(state: LiveSessionState): { recorded: number; total: number } {
  return { recorded: state.records.length, total: state.snapshot?.stops.length ?? 0 };
}

/** True once a session has started or has recorded anything: Reset then needs confirmation. */
export function needsResetConfirmation(state: LiveSessionState): boolean {
  return state.stopwatch.status !== "idle" || state.records.length > 0;
}

// ---------------------------------------------------------------- actions

export type StartOutcome = { ok: true; state: LiveSessionState } | { ok: false; reason: "already-started" };

/** Take the snapshot and start the stopwatch from zero. Refused unless the session is idle. */
export function startSession(state: LiveSessionState, snapshot: SessionSnapshot, nowMs: number): StartOutcome {
  if (state.stopwatch.status !== "idle") return { ok: false, reason: "already-started" };
  return {
    ok: true,
    state: {
      stopwatch: startStopwatch(IDLE_STOPWATCH, nowMs),
      snapshot,
      records: [],
      lastRecordAtMs: null,
    },
  };
}

/** Pause a running session. Returns the same object if it isn't running (or is finished). */
export function pauseSession(state: LiveSessionState, nowMs: number): LiveSessionState {
  if (sessionPhase(state) !== "running") return state;
  return { ...state, stopwatch: pauseStopwatch(state.stopwatch, nowMs) };
}

/** Resume a paused session from where it stopped. Returns the same object if it isn't paused. */
export function resumeSession(state: LiveSessionState, nowMs: number): LiveSessionState {
  if (sessionPhase(state) !== "paused") return state;
  return { ...state, stopwatch: resumeStopwatch(state.stopwatch, nowMs) };
}

export function resetSession(): LiveSessionState {
  return INITIAL_SESSION;
}

export type RecordRefusal = "not-running" | "already-complete" | "wrong-location" | "too-soon";

export type RecordOutcome =
  | { ok: true; state: LiveSessionState; record: PassingRecord; stop: SessionStop; finished: boolean }
  | { ok: false; reason: RecordRefusal };

/**
 * Record the runner passing the next location, at clock reading `nowMs`.
 *
 * The time is taken from the stopwatch's own timing state at `nowMs` (full precision),
 * never from a formatted string. `expectedLocationId` is the location the coach was
 * looking at when they pressed the button; if the session has moved on, the press is
 * refused rather than recorded against a different place.
 *
 * Recording the finish freezes the stopwatch at that same reading, so the
 * stopwatch face and the finish time agree to the hundredth.
 */
export function recordPassing(state: LiveSessionState, nowMs: number, expectedLocationId?: string): RecordOutcome {
  const phase = sessionPhase(state);
  if (phase === "finished") return { ok: false, reason: "already-complete" };
  if (phase !== "running") return { ok: false, reason: "not-running" };

  const stop = nextStop(state);
  if (stop === null) return { ok: false, reason: "already-complete" };
  if (expectedLocationId !== undefined && expectedLocationId !== stop.id) {
    return { ok: false, reason: "wrong-location" };
  }
  if (state.lastRecordAtMs !== null && nowMs - state.lastRecordAtMs < MIN_RECORD_GAP_MS) {
    return { ok: false, reason: "too-soon" };
  }

  const record: PassingRecord = {
    locationId: stop.id,
    actualSeconds: stopwatchElapsedMs(state.stopwatch, nowMs) / 1000,
  };
  const records = [...state.records, record];
  const finished = snapshotLength(state) === records.length;
  return {
    ok: true,
    record,
    stop,
    finished,
    state: {
      ...state,
      records,
      lastRecordAtMs: nowMs,
      stopwatch: finished ? pauseStopwatch(state.stopwatch, nowMs) : state.stopwatch,
    },
  };
}

function snapshotLength(state: LiveSessionState): number {
  return state.snapshot?.stops.length ?? 0;
}

// ---------------------------------------------------------------- reading results

export interface RecordedRow {
  stop: SessionStop;
  actualSeconds: number;
  comparison: PassingComparison;
}

/** Recorded locations in the order they were recorded, each with its target and comparison. */
export function recordedRows(state: LiveSessionState): RecordedRow[] {
  const { snapshot } = state;
  if (snapshot === null) return [];
  const byId = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
  const rows: RecordedRow[] = [];
  for (const record of state.records) {
    const stop = byId.get(record.locationId);
    if (stop === undefined) continue; // can't happen: records are only created for snapshot stops
    rows.push({ stop, actualSeconds: record.actualSeconds, comparison: comparePassingTime(stop.targetSeconds, record.actualSeconds) });
  }
  return rows;
}

export interface FinishSummary {
  actualSeconds: number;
  targetSeconds: number;
  comparison: PassingComparison;
}

/** The overall result, available once the finish has been recorded. */
export function finishSummary(state: LiveSessionState): FinishSummary | null {
  if (!isComplete(state)) return null;
  const finish = recordedRows(state).find((row) => row.stop.isFinish);
  if (!finish) return null;
  return { actualSeconds: finish.actualSeconds, targetSeconds: finish.stop.targetSeconds, comparison: finish.comparison };
}

// ---------------------------------------------------------------- location-editing rules

export interface EditPolicy {
  allowed: boolean;
  /** Plain-language reason shown when editing is unavailable. */
  reason: string | null;
}

/**
 * May pacing locations be changed right now?
 *  - No session: yes.
 *  - Running: no.
 *  - Paused with nothing recorded: yes (the coach may go back and adjust; the session then
 *    shows as outdated and keeps its original targets until reset).
 *  - Paused with recorded times, or finished: no. Reset first.
 */
export function locationEditPolicy(state: LiveSessionState): EditPolicy {
  switch (sessionPhase(state)) {
    case "idle":
      return { allowed: true, reason: null };
    case "running":
      return {
        allowed: false,
        reason: "Locations are locked while the stopwatch is running, so recorded times can't end up attached to the wrong place. Pause or reset the session to change them.",
      };
    case "paused":
      return state.records.length === 0
        ? { allowed: true, reason: null }
        : {
            allowed: false,
            reason: "Locations are locked because passing times have been recorded. Reset the live session to change them. Resetting clears the recorded times.",
          };
    case "finished":
      return {
        allowed: false,
        reason: "Locations are locked because this session has recorded times. Reset the live session to change them. Resetting clears the recorded times.",
      };
  }
}
