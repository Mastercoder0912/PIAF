import { useMemo, useState } from "react";
import { StopwatchDisplay } from "../components/StopwatchDisplay";
import { formatDistanceInUnit, formatMeters } from "../display";
import { formatDistanceLabel, type RaceCalculation, type ResolvedPacingLocations } from "../engine";
import { STATUS_LABEL, type PassingStatus } from "../live/comparison";
import {
  describeDifference,
  formatActualTime,
  formatSignedDifference,
  formatStopwatch,
  formatTargetTime,
} from "../live/format";
import {
  MIN_RECORD_GAP_MS,
  buildSnapshot,
  finishSummary,
  getStartBlocker,
  isSessionOutdated,
  needsResetConfirmation,
  nextStop,
  recordedRows,
  sessionPhase,
  sessionProgress,
  type RecordedRow,
  type SessionPhase,
  type SessionStop,
} from "../live/session";
import type { StoredLocation } from "../state/locations";
import type { LiveSessionStore } from "../state/useLiveSession";

interface LivePacerViewProps {
  live: LiveSessionStore;
  /** The calculator's current race, or null. Used to preview and to start a NEW session only. */
  race: RaceCalculation | null;
  resolved: ResolvedPacingLocations<StoredLocation> | null;
  isStale: boolean;
  onOpenCalculator: () => void;
  onOpenLocations: () => void;
}

const PHASE_LABEL: Record<SessionPhase, string> = {
  idle: "Ready",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
};

function stopDistance(stop: SessionStop): string {
  return stop.unit ? formatDistanceInUnit(stop.distanceMeters, stop.unit) : formatDistanceLabel(stop.distanceMeters);
}

/** "1.2 km · 1200 m" for locations entered in another unit; the plain distance otherwise. */
function StopDistance({ stop }: { stop: SessionStop }) {
  return (
    <>
      {stopDistance(stop)}
      {stop.unit && stop.unit !== "m" ? <span className="loc-meters">{` · ${formatMeters(stop.distanceMeters)}`}</span> : null}
    </>
  );
}

function StatusBadge({ status }: { status: PassingStatus }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>;
}

function RecordedItem({ row }: { row: RecordedRow }) {
  const { stop, actualSeconds, comparison } = row;
  return (
    <li className="rec" data-location-id={stop.id}>
      <div className="rec-head">
        <div className="rec-info">
          <p className="loc-name">{stop.name}</p>
          <p className="loc-dist">
            <StopDistance stop={stop} />
          </p>
        </div>
        <StatusBadge status={comparison.status} />
      </div>
      <dl className="rec-values">
        <div>
          <dt>Target</dt>
          <dd>{formatTargetTime(stop.targetSeconds)}</dd>
        </div>
        <div>
          <dt>Actual</dt>
          <dd>{formatActualTime(actualSeconds)}</dd>
        </div>
        <div className={`rec-diff diff-${comparison.status}`}>
          <dt>Difference</dt>
          <dd>
            {formatSignedDifference(comparison.differenceSeconds)}
            <span className="sr-only">{`, ${describeDifference(comparison.differenceSeconds, comparison.status)}`}</span>
          </dd>
        </div>
      </dl>
    </li>
  );
}

const REFUSAL_NOTICE = `Ignored: that location was just recorded. Press once for each location (presses closer than ${
  MIN_RECORD_GAP_MS / 1000
} s are treated as a double tap).`;

/**
 * Live Pacer: stopwatch, next location, Record Passing Time, and the results so far.
 *
 * The session uses its own frozen copy of the race and locations (taken when the stopwatch
 * starts). The calculator's current race is only used to preview the first location and to
 * start a new session, and to warn if it has changed since.
 */
export function LivePacerView({ live, race, resolved, isStale, onOpenCalculator, onOpenLocations }: LivePacerViewProps) {
  const { state } = live;
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const phase = sessionPhase(state);
  const currentSnapshot = useMemo(
    () => (race && resolved ? buildSnapshot(race, resolved) : null),
    [race, resolved],
  );
  const outdated = isSessionOutdated(state, currentSnapshot?.key ?? null);
  const blocker =
    phase === "idle"
      ? getStartBlocker({
          hasRace: currentSnapshot !== null,
          isStale,
          needsAttentionCount: resolved?.outOfRange.length ?? 0,
        })
      : null;

  const snapshot = state.snapshot ?? currentSnapshot;
  const next: SessionStop | null = phase === "idle" ? (snapshot?.stops[0] ?? null) : nextStop(state);
  const progress = sessionProgress(state);
  const total = snapshot?.stops.length ?? 0;
  const rows = recordedRows(state);
  const summary = finishSummary(state);

  function announce(message: string) {
    setAnnouncement(message);
  }

  function handleToggle() {
    if (phase === "idle") {
      if (blocker || currentSnapshot === null) return;
      live.start(currentSnapshot);
      setNotice(null);
      announce("Stopwatch started.");
    } else if (phase === "running") {
      live.pause();
      announce(`Paused at ${formatStopwatch(live.getElapsedSeconds())}.`);
    } else if (phase === "paused") {
      live.resume();
      announce("Stopwatch resumed.");
    }
  }

  function handleRecord() {
    if (next === null) return;
    // The clock is read inside live.record(), immediately, before any state update or render.
    const outcome = live.record(next.id);
    if (!outcome.ok) {
      if (outcome.reason === "too-soon" || outcome.reason === "wrong-location") setNotice(REFUSAL_NOTICE);
      return;
    }
    setNotice(null);
    const row = recordedRows(outcome.state).find((r) => r.stop.id === outcome.stop.id);
    if (row) {
      announce(
        `${outcome.finished ? "Finish recorded. " : ""}${row.stop.name}: ${formatActualTime(row.actualSeconds)}, ${describeDifference(row.comparison.differenceSeconds, row.comparison.status)}.`,
      );
    }
  }

  function handleResetClick() {
    if (needsResetConfirmation(state)) setConfirmingReset(true);
    else live.reset();
  }

  function confirmReset() {
    live.reset();
    setConfirmingReset(false);
    setNotice(null);
    announce("Session reset.");
    queueMicrotask(() => document.getElementById("live-toggle")?.focus());
  }

  function cancelReset() {
    setConfirmingReset(false);
    document.getElementById("live-reset")?.focus();
  }

  const toggleLabel = phase === "idle" ? "Start" : phase === "running" ? "Pause" : "Resume";
  const finished = phase === "finished";
  const recordHint =
    phase === "running" && next
      ? `Press the moment the runner passes ${next.name}.`
      : phase === "paused"
        ? "The stopwatch is paused. Resume it to record."
        : phase === "idle"
          ? "Start the stopwatch to record passing times."
          : "";

  return (
    <div className="live">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="live-main">
        {outdated ? (
          <div className="live-warning" role="alert">
            <p className="live-warning-title">The race or locations have changed since this session started.</p>
            <p>
              This session keeps using the targets it started with, so the times you've recorded stay correct. To use the
              changed setup, reset this session and start a new one.
            </p>
          </div>
        ) : null}

        <section className="card live-clock" aria-label="Stopwatch">
          <div className="live-clock-head">
            <span className={`live-phase phase-${phase}`}>{PHASE_LABEL[phase]}</span>
            {total > 0 ? (
              <span className="live-progress">{`${progress.recorded} of ${total} recorded`}</span>
            ) : null}
          </div>
          <StopwatchDisplay getElapsedSeconds={live.getElapsedSeconds} running={phase === "running"} />
        </section>

        {finished && summary ? (
          <section className="card live-summary" aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="group-title">
              Race complete
            </h2>
            <dl className="summary-values">
              <div>
                <dt>Actual time</dt>
                <dd>{formatActualTime(summary.actualSeconds)}</dd>
              </div>
              <div>
                <dt>Target time</dt>
                <dd>{formatTargetTime(summary.targetSeconds)}</dd>
              </div>
              <div className={`diff-${summary.comparison.status}`}>
                <dt>Overall</dt>
                <dd>
                  {formatSignedDifference(summary.comparison.differenceSeconds)}
                  <StatusBadge status={summary.comparison.status} />
                  <span className="sr-only">{`, ${describeDifference(summary.comparison.differenceSeconds, summary.comparison.status)}`}</span>
                </dd>
              </div>
            </dl>
          </section>
        ) : (
          <section className="card live-next" aria-labelledby="next-heading">
            <h2 id="next-heading" className="group-title">
              {next?.isFinish ? "Finish line" : phase === "idle" ? "First location" : "Next location"}
            </h2>
            {next ? (
              <>
                <div className="next-main">
                  <div className="next-info">
                    <p className="next-name">{next.name}</p>
                    <p className="loc-dist">
                      <StopDistance stop={next} />
                    </p>
                  </div>
                  <p className="next-target">
                    <span className="next-target-label">Target</span>
                    {formatTargetTime(next.targetSeconds)}
                  </p>
                </div>
                <p className="next-position">
                  {next.isFinish
                    ? total > 1
                      ? `Last location (${total} of ${total})`
                      : "The only location"
                    : `Location ${progress.recorded + 1} of ${total}`}
                </p>
              </>
            ) : (
              <p className="placeholder">No locations to record.</p>
            )}
          </section>
        )}

        {!finished ? (
          <div className="live-record">
            <button
              type="button"
              id="live-record"
              className="btn btn-primary btn-record"
              disabled={phase !== "running" || next === null}
              aria-describedby="record-hint"
              onClick={handleRecord}
            >
              Record Passing Time
            </button>
            <p id="record-hint" className="hint">
              {recordHint}
            </p>
          </div>
        ) : null}

        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="live-controls">
          {!finished ? (
            <button
              type="button"
              id="live-toggle"
              className={phase === "idle" ? "btn btn-primary" : "btn btn-secondary btn-toggle"}
              disabled={phase === "idle" && blocker !== null}
              aria-describedby={blocker ? "start-blocker" : undefined}
              onClick={handleToggle}
            >
              {toggleLabel}
            </button>
          ) : null}
          <button
            type="button"
            id="live-reset"
            className="btn btn-secondary"
            disabled={phase === "idle"}
            onClick={handleResetClick}
          >
            Reset
          </button>
        </div>

        {blocker ? (
          <div className="notice live-blocker" id="start-blocker">
            <p>{blocker.message}</p>
            {blocker.code === "stale-inputs" ? (
              <button type="button" className="btn btn-secondary btn-small" onClick={onOpenCalculator}>
                Go to calculator
              </button>
            ) : null}
            {blocker.code === "needs-attention" ? (
              <button type="button" className="btn btn-secondary btn-small" onClick={onOpenLocations}>
                Go to locations
              </button>
            ) : null}
          </div>
        ) : null}

        {confirmingReset ? (
          <div
            className="confirm"
            role="alertdialog"
            aria-labelledby="reset-live-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelReset();
            }}
          >
            <p id="reset-live-title">
              {rows.length > 0
                ? `Reset the live session? This stops the stopwatch and clears the ${rows.length} recorded passing ${rows.length === 1 ? "time" : "times"}.`
                : "Reset the live session? This stops the stopwatch and returns it to zero."}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-danger" onClick={confirmReset}>
                Yes, reset session
              </button>
              <button type="button" className="btn btn-secondary" onClick={cancelReset} autoFocus>
                Keep session
              </button>
            </div>
          </div>
        ) : null}

      </div>

      <section className="card" aria-labelledby="recorded-heading">
        <h2 id="recorded-heading" className="group-title">
          Recorded passing times
        </h2>
        {rows.length === 0 ? (
          <p className="placeholder">No passing times recorded yet.</p>
        ) : (
          <ul className="rec-list" aria-label="Recorded passing times, latest first">
            {[...rows].reverse().map((row) => (
              <RecordedItem key={row.stop.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
