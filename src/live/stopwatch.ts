/**
 * Stopwatch state machine. Pure functions only: no React, no timers, no globals.
 *
 * Accuracy rule: elapsed time is ALWAYS computed from clock readings, never by
 * counting ticks. A "clock" is any function returning monotonic milliseconds
 * (in the browser, `performance.now`). Because nothing here depends on how often
 * the screen refreshes, a throttled or hidden tab, a slow frame, or a re-render
 * cannot change the result: reading the clock later simply gives the right answer.
 *
 * Every function takes `nowMs` explicitly, so tests can drive time deterministically.
 */

/** Returns monotonic milliseconds (fractional values allowed). */
export type Clock = () => number;

export type StopwatchStatus = "idle" | "running" | "paused";

export interface StopwatchState {
  status: StopwatchStatus;
  /** Time banked from earlier running periods (ms). Always >= 0. */
  accumulatedMs: number;
  /** Clock reading when the current running period began. Null unless running. */
  startedAtMs: number | null;
}

export const IDLE_STOPWATCH: StopwatchState = { status: "idle", accumulatedMs: 0, startedAtMs: null };

function assertClockReading(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`Clock reading must be a finite number (got ${nowMs}).`);
  }
}

/** Time since `startedAtMs`, never negative even if a bad clock goes backwards. */
function periodMs(startedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startedAtMs);
}

/**
 * Start from zero. Only valid when idle; any other state is returned unchanged,
 * so a second Start can never create a second, overlapping run.
 */
export function startStopwatch(state: StopwatchState, nowMs: number): StopwatchState {
  assertClockReading(nowMs);
  if (state.status !== "idle") return state;
  return { status: "running", accumulatedMs: 0, startedAtMs: nowMs };
}

/** Freeze the elapsed time, keeping it. Only valid when running. */
export function pauseStopwatch(state: StopwatchState, nowMs: number): StopwatchState {
  assertClockReading(nowMs);
  if (state.status !== "running" || state.startedAtMs === null) return state;
  return {
    status: "paused",
    accumulatedMs: state.accumulatedMs + periodMs(state.startedAtMs, nowMs),
    startedAtMs: null,
  };
}

/** Continue from the paused elapsed time. Only valid when paused. */
export function resumeStopwatch(state: StopwatchState, nowMs: number): StopwatchState {
  assertClockReading(nowMs);
  if (state.status !== "paused") return state;
  return { status: "running", accumulatedMs: state.accumulatedMs, startedAtMs: nowMs };
}

/** Back to the initial state, discarding all elapsed time. */
export function resetStopwatch(): StopwatchState {
  return IDLE_STOPWATCH;
}

/** Elapsed milliseconds at clock reading `nowMs`, full precision, never negative. */
export function stopwatchElapsedMs(state: StopwatchState, nowMs: number): number {
  assertClockReading(nowMs);
  if (state.status === "running" && state.startedAtMs !== null) {
    return state.accumulatedMs + periodMs(state.startedAtMs, nowMs);
  }
  return state.accumulatedMs;
}

/** Elapsed seconds at clock reading `nowMs`, full precision (not rounded to hundredths). */
export function stopwatchElapsedSeconds(state: StopwatchState, nowMs: number): number {
  return stopwatchElapsedMs(state, nowMs) / 1000;
}
