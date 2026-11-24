import { useCallback, useRef, useState } from "react";
import {
  INITIAL_SESSION,
  pauseSession,
  recordPassing,
  resetSession,
  resumeSession,
  startSession,
  type LiveSessionState,
  type RecordOutcome,
  type SessionSnapshot,
  type StartOutcome,
} from "../live/session";
import { stopwatchElapsedSeconds, type Clock } from "../live/stopwatch";

/** The browser's monotonic clock: unaffected by system clock changes, and keeps counting in background tabs. */
export const browserClock: Clock = () => performance.now();

/**
 * React wrapper around the pure session functions. It lives in <App>, above the screens,
 * so the stopwatch keeps running while you look at the calculator or the location list.
 *
 * Timing rule: every action reads the clock FIRST, inside the event handler, and passes that
 * reading to the pure function. Nothing waits for a render. The latest state is also kept in
 * a ref so two presses in the same instant are evaluated one after the other against the
 * current state, never against a stale render.
 *
 * Nothing is persisted.
 */
export function useLiveSession(clock: Clock = browserClock) {
  const latest = useRef<LiveSessionState>(INITIAL_SESSION);
  const [state, setState] = useState<LiveSessionState>(INITIAL_SESSION);

  const commit = useCallback((next: LiveSessionState) => {
    latest.current = next;
    setState(next);
  }, []);

  const start = useCallback(
    (snapshot: SessionSnapshot): StartOutcome => {
      const now = clock();
      const outcome = startSession(latest.current, snapshot, now);
      if (outcome.ok) commit(outcome.state);
      return outcome;
    },
    [clock, commit],
  );

  const pause = useCallback(() => {
    const now = clock();
    const next = pauseSession(latest.current, now);
    if (next !== latest.current) commit(next);
  }, [clock, commit]);

  const resume = useCallback(() => {
    const now = clock();
    const next = resumeSession(latest.current, now);
    if (next !== latest.current) commit(next);
  }, [clock, commit]);

  const record = useCallback(
    (expectedLocationId?: string): RecordOutcome => {
      const now = clock(); // captured immediately, before anything else happens
      const outcome = recordPassing(latest.current, now, expectedLocationId);
      if (outcome.ok) commit(outcome.state);
      return outcome;
    },
    [clock, commit],
  );

  const reset = useCallback(() => commit(resetSession()), [commit]);

  /** Elapsed seconds right now, full precision. The display reads this on every frame; it is not stored anywhere. */
  const getElapsedSeconds = useCallback(
    () => stopwatchElapsedSeconds(latest.current.stopwatch, clock()),
    [clock],
  );

  return { state, start, pause, resume, record, reset, getElapsedSeconds };
}

export type LiveSessionStore = ReturnType<typeof useLiveSession>;
