import {
  formatDistanceLabel,
  type OutOfRangeLocation,
  type OutOfRangeReason,
  type ResolvedPacingLocation,
  type ResolvedPacingLocations,
} from "../engine";
import { formatDistanceInUnit, formatMeters, formatTenths } from "../display";
import {
  locationToFormValues,
  type LocationErrors,
  type LocationFormValues,
  type StoredLocation,
} from "../state/locations";
import { LocationForm } from "./LocationForm";

interface EditHandlers {
  /** True while a live session locks the locations: Edit and Delete are shown but unavailable. */
  disabled?: boolean;
  editingId: string | null;
  /** Hint shown under the distance box while editing. */
  distanceHint: string;
  onEdit: (id: string) => void;
  onCancelEdit: (id: string) => void;
  onSave: (id: string, values: LocationFormValues) => LocationErrors | null;
  onDelete: (id: string) => void;
}

function DistanceLine({ location }: { location: StoredLocation }) {
  return (
    <p className="loc-dist">
      {formatDistanceInUnit(location.distanceMeters, location.unit)}
      {location.unit !== "m" ? (
        <span className="loc-meters">{` · ${formatMeters(location.distanceMeters)}`}</span>
      ) : null}
    </p>
  );
}

function Actions({
  location,
  disabled,
  onEdit,
  onDelete,
}: { location: StoredLocation } & Pick<EditHandlers, "disabled" | "onEdit" | "onDelete">) {
  return (
    <div className="loc-actions">
      <button
        type="button"
        id={`edit-${location.id}`}
        className="btn btn-secondary btn-small"
        aria-label={`Edit ${location.name}`}
        disabled={disabled}
        aria-describedby={disabled ? "locations-locked" : undefined}
        onClick={() => onEdit(location.id)}
      >
        Edit
      </button>
      <button
        type="button"
        id={`delete-${location.id}`}
        className="btn btn-secondary btn-small"
        aria-label={`Delete ${location.name}`}
        disabled={disabled}
        aria-describedby={disabled ? "locations-locked" : undefined}
        onClick={() => onDelete(location.id)}
      >
        Delete
      </button>
    </div>
  );
}

function EditingRow({ location, handlers }: { location: StoredLocation; handlers: EditHandlers }) {
  return (
    <li className="loc is-editing" data-location-id={location.id}>
      <LocationForm
        variant="edit"
        initial={locationToFormValues(location)}
        distanceHint={handlers.distanceHint}
        onSubmit={(values) => handlers.onSave(location.id, values)}
        onCancel={() => handlers.onCancelEdit(location.id)}
      />
    </li>
  );
}

function LocationRow({
  location,
  handlers,
}: {
  location: StoredLocation & { targetTimeSeconds: number };
  handlers: EditHandlers;
}) {
  if (handlers.editingId === location.id) return <EditingRow location={location} handlers={handlers} />;
  return (
    <li className="loc" data-location-id={location.id}>
      <div className="loc-head">
        <div className="loc-info">
          <p className="loc-name">{location.name}</p>
          <DistanceLine location={location} />
        </div>
        <p className="loc-time">
          <span className="sr-only">Target time </span>
          {formatTenths(location.targetTimeSeconds)}
        </p>
      </div>
      <Actions location={location} disabled={handlers.disabled} onEdit={handlers.onEdit} onDelete={handlers.onDelete} />
    </li>
  );
}

/** The automatic finish: shown like the others but locked (no Edit/Delete exist for it at all). */
function FinishRow({ finish }: { finish: ResolvedPacingLocation }) {
  return (
    <li className="loc finish-loc" data-location-id={finish.id}>
      <div className="loc-head">
        <div className="loc-info">
          <p className="loc-name">
            {finish.name}
            <span className="finish-pill">Automatic</span>
          </p>
          <p className="loc-dist">{formatDistanceLabel(finish.distanceMeters)}</p>
        </div>
        <p className="loc-time">
          <span className="sr-only">Target time </span>
          {formatTenths(finish.targetTimeSeconds)}
        </p>
      </div>
      <p className="loc-locked">Added automatically. It can't be edited or deleted.</p>
    </li>
  );
}

/** Locations in race order, then the finish. Order comes from the engine (by distance), not creation order. */
export function LocationList({
  resolved,
  ...handlers
}: { resolved: ResolvedPacingLocations<StoredLocation> } & EditHandlers) {
  return (
    <ul className="loc-list" aria-label="Pacing locations in race order">
      {resolved.locations.map((location) => (
        <LocationRow key={location.id} location={location} handlers={handlers} />
      ))}
      <FinishRow finish={resolved.finish} />
    </ul>
  );
}

const REASON_TEXT: Record<OutOfRangeReason, (raceDistance: string) => string> = {
  "beyond-race": (raceDistance) => `Beyond the ${raceDistance} race distance, so it has no target time.`,
  "at-finish": () => "Now at the same place as the finish line, so it has no target time.",
  "invalid-distance": () => "This distance isn't valid, so it has no target time.",
};

/**
 * Locations the current race can't use (for example after the race got shorter).
 * They are kept rather than silently deleted or given an old time, and can be fixed or removed.
 */
export function AttentionList({
  items,
  raceDistanceLabel,
  ...handlers
}: { items: OutOfRangeLocation<StoredLocation>[]; raceDistanceLabel: string } & EditHandlers) {
  return (
    <ul className="loc-list" aria-label="Locations that don't fit the current race">
      {items.map(({ location, reason }) =>
        handlers.editingId === location.id ? (
          <EditingRow key={location.id} location={location} handlers={handlers} />
        ) : (
          <li key={location.id} className="loc is-warning" data-location-id={location.id}>
            <div className="loc-head">
              <div className="loc-info">
                <p className="loc-name">{location.name}</p>
                <DistanceLine location={location} />
              </div>
              <p className="loc-time loc-time-none" aria-label="No target time">
                —
              </p>
            </div>
            <p className="loc-warning">{REASON_TEXT[reason](raceDistanceLabel)} Edit it or delete it.</p>
            <Actions location={location} disabled={handlers.disabled} onEdit={handlers.onEdit} onDelete={handlers.onDelete} />
          </li>
        ),
      )}
    </ul>
  );
}
