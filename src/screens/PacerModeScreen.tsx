import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BLANK_LOCATION_FORM, LocationForm } from "../components/LocationForm";
import { AttentionList, LocationList } from "../components/LocationList";
import { formatTenths } from "../display";
import { formatDistanceLabel, resolvePacingLocations, type RaceCalculation } from "../engine";
import { locationEditPolicy, sessionPhase } from "../live/session";
import { NO_RACE_MESSAGE, type LocationErrors, type LocationFormValues } from "../state/locations";
import type { LiveSessionStore } from "../state/useLiveSession";
import type { LocationsStore } from "../state/useLocations";
import { LivePacerView } from "./LivePacerView";

export type PacerView = "setup" | "live";

interface PacerModeScreenProps {
  /** The last successfully calculated race, or null if there is none. Locations get their times from it. */
  race: RaceCalculation | null;
  /** True when calculator inputs have changed since `race` was calculated. */
  isStale: boolean;
  locations: LocationsStore;
  /** The live session (stopwatch + recorded times). Kept in App so it survives switching screens. */
  live: LiveSessionStore;
  view: PacerView;
  onViewChange: (view: PacerView) => void;
  onOpenCalculator: () => void;
  /** Optional extra card shown under the active race on the Locations view (the weather). */
  weatherSlot?: ReactNode;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Pacer Mode: choose where to watch runners and see the target passing time at each place.
 * Locations are independent of the split table. Only name and distance are stored;
 * every time shown here is derived from `race`, so it can't be out of date.
 */
export function PacerModeScreen({
  race,
  isStale,
  locations,
  live,
  view,
  onViewChange,
  onOpenCalculator,
  weatherSlot,
}: PacerModeScreenProps) {
  const [editingIdState, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusEditFor, setFocusEditFor] = useState<string | null>(null);
  const [focusUndo, setFocusUndo] = useState(false);

  const resolved = useMemo(
    () => (race ? resolvePacingLocations(locations.items, race) : null),
    [locations.items, race],
  );

  // While a live session is running (or has recorded times), locations are locked so a recorded
  // time can't end up attached to the wrong place. Nothing is discarded; it is just read-only.
  const editPolicy = locationEditPolicy(live.state);
  const locked = !editPolicy.allowed;
  const sessionActive = sessionPhase(live.state) !== "idle";
  const editingId = locked ? null : editingIdState;

  // After saving, cancelling or undoing, put keyboard focus back on that row's Edit button.
  useEffect(() => {
    if (focusEditFor === null || editingId !== null) return;
    document.getElementById(`edit-${focusEditFor}`)?.focus();
    setFocusEditFor(null);
  }, [focusEditFor, editingId, locations.items]);

  // After a delete the row is gone, so move focus to Undo rather than losing it.
  useEffect(() => {
    if (!focusUndo || locations.lastDeleted === null) return;
    document.getElementById("undo-delete")?.focus();
    setFocusUndo(false);
  }, [focusUndo, locations.lastDeleted]);

  const noRaceCard = (
    <section className="card pacer-empty" aria-labelledby="pacer-heading">
      <span className="badge">Calculate first</span>
      <h2 id="pacer-heading" className="screen-title">
        Pacer Mode
      </h2>
      <p>{NO_RACE_MESSAGE}</p>
      <p className="hint">
        Each location's target time comes from the race you calculate, so there is nothing to time
        until one exists.
      </p>
      {locations.count > 0 ? (
        <p className="hint">
          {`Your ${plural(locations.count, "saved location")} will reappear here once a race is calculated.`}
        </p>
      ) : null}
      <button type="button" className="btn btn-primary" onClick={onOpenCalculator}>
        Go to calculator
      </button>
    </section>
  );

  // No race and no live session: just the explanation. (A running session can outlive the calculator's race.)
  if ((race === null || resolved === null) && !sessionActive) return noRaceCard;

  const viewSwitch = (
    <div className="view-switch" role="group" aria-label="Pacer Mode view">
      <button
        type="button"
        className="view-btn"
        aria-pressed={view === "setup"}
        onClick={() => onViewChange("setup")}
      >
        Locations
      </button>
      <button
        type="button"
        className="view-btn"
        aria-pressed={view === "live"}
        onClick={() => onViewChange("live")}
      >
        Live Pacer
      </button>
    </div>
  );

  if (view === "live") {
    return (
      <div className="stack">
        {viewSwitch}
        <LivePacerView
          live={live}
          race={race}
          resolved={resolved}
          isStale={isStale}
          onOpenCalculator={onOpenCalculator}
          onOpenLocations={() => onViewChange("setup")}
        />
      </div>
    );
  }

  if (race === null || resolved === null) {
    return (
      <div className="stack">
        {viewSwitch}
        {noRaceCard}
      </div>
    );
  }

  const raceDistanceLabel = formatDistanceLabel(race.totalDistanceMeters);
  const distanceHint = `Must be before the finish (${raceDistanceLabel}).`;

  function handleAdd(values: LocationFormValues): LocationErrors | null {
    if (locked) return { general: [editPolicy.reason ?? "Locations are locked."] };
    const outcome = locations.add(values, race);
    if (!outcome.ok) return outcome.errors;
    setNotice(`Added "${values.name.trim()}".`);
    return null;
  }

  function handleSave(id: string, values: LocationFormValues): LocationErrors | null {
    if (locked) return { general: [editPolicy.reason ?? "Locations are locked."] };
    const outcome = locations.update(id, values, race);
    if (!outcome.ok) return outcome.errors;
    setEditingId(null);
    setFocusEditFor(id);
    setNotice(`Saved "${values.name.trim()}".`);
    return null;
  }

  function handleDelete(id: string) {
    if (locked) return;
    const outcome = locations.remove(id);
    if (!outcome.ok) return;
    if (editingId === id) setEditingId(null);
    setNotice(null);
    setFocusUndo(true);
  }

  function handleUndo() {
    if (locked) return;
    const restored = locations.lastDeleted;
    locations.undo();
    if (restored) {
      setNotice(`Restored "${restored.name}".`);
      setFocusEditFor(restored.id);
    }
  }

  function handleImport() {
    if (locked) return;
    const outcome = locations.importFromSplits(race);
    if (!outcome.ok) {
      setNotice(outcome.errors.general?.[0] ?? NO_RACE_MESSAGE);
    } else if (outcome.added > 0) {
      const skipped =
        outcome.skippedExisting > 0 ? ` ${plural(outcome.skippedExisting, "split")} already had a location and ${outcome.skippedExisting === 1 ? "was" : "were"} skipped.` : "";
      setNotice(`Imported ${plural(outcome.added, "location")} from the split table.${skipped}`);
    } else if (outcome.skippedExisting > 0) {
      setNotice("Nothing new to import: every split already has a location.");
    } else {
      setNotice("There are no splits to import. The finish line is always included automatically.");
    }
    setEditingId(null);
  }

  const handlers = {
    disabled: locked,
    editingId,
    distanceHint,
    onEdit: (id: string) => setEditingId(id),
    onCancelEdit: (id: string) => {
      setEditingId(null);
      setFocusEditFor(id);
    },
    onSave: handleSave,
    onDelete: handleDelete,
  };

  return (
    <div className="stack">
      {viewSwitch}
      <section className="card race-card" aria-labelledby="race-heading">
        <h2 id="race-heading" className="group-title">
          Active race
        </h2>
        <dl className="race-line">
          <div>
            <dt>Distance</dt>
            <dd>{raceDistanceLabel}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatTenths(race.totalTimeSeconds)}</dd>
          </div>
          <div>
            <dt>Pace</dt>
            <dd>
              {formatTenths(race.paceSecondsPerMile)}
              <span className="stat-unit"> /mi</span>
            </dd>
          </div>
        </dl>
        {isStale ? (
          <div className="stale-note" role="status">
            <p>
              The calculator inputs have changed since this race was calculated. Times below use the last
              calculation.
            </p>
            <button type="button" className="btn btn-secondary btn-small" onClick={onOpenCalculator}>
              Go to calculator
            </button>
          </div>
        ) : null}
      </section>

      {weatherSlot}

      <div className="layout">
        <section className="card" aria-labelledby="add-heading">
          <h2 id="add-heading" className="group-title">
            Add location
          </h2>
          <fieldset className="plain-fieldset" disabled={locked} aria-describedby={locked ? "locations-locked" : undefined}>
            <LocationForm variant="add" initial={BLANK_LOCATION_FORM} distanceHint={distanceHint} onSubmit={handleAdd} />

            <div className="import-box">
              <h3 className="group-title">Import splits</h3>
              <p className="hint">
                Add every split from the calculator as its own location. Locations you made are kept, and
                distances that already have a location are skipped.
              </p>
              <button type="button" className="btn btn-secondary" onClick={handleImport}>
                Import splits as locations
              </button>
            </div>
          </fieldset>
        </section>

        <section className="card results" aria-labelledby="locations-heading">
          <h2 id="locations-heading" className="group-title">
            Pacing locations
          </h2>

          {locked ? (
            <div className="notice lock-note" id="locations-locked" role="status">
              <p>{editPolicy.reason}</p>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => onViewChange("live")}>
                Go to Live Pacer
              </button>
            </div>
          ) : null}

          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}

          {locations.lastDeleted && !locked ? (
            <div className="notice" role="status">
              <p>{`Deleted "${locations.lastDeleted.name}".`}</p>
              <button type="button" id="undo-delete" className="btn btn-secondary btn-small" onClick={handleUndo}>
                Undo
              </button>
            </div>
          ) : null}

          {locations.count === 0 ? (
            <p className="placeholder">
              No locations yet. Add one, or import the splits. The finish line is always included.
            </p>
          ) : null}

          <LocationList resolved={resolved} {...handlers} />

          {resolved.outOfRange.length > 0 ? (
            <section className="attention" aria-labelledby="attention-heading">
              <h3 id="attention-heading" className="group-title">
                Needs attention
              </h3>
              <p className="hint">
                {`These ${plural(resolved.outOfRange.length, "location")} no longer fit the ${raceDistanceLabel} race. They're kept so you can fix or delete them.`}
              </p>
              <AttentionList items={resolved.outOfRange} raceDistanceLabel={raceDistanceLabel} {...handlers} />
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
