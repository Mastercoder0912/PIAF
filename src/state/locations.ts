import {
  FINISH_LOCATION_ID,
  LOCATION_DISTANCE_FIELD,
  LOCATION_NAME_FIELD,
  distancesEqual,
  fromMeters,
  planSplitImport,
  toMeters,
  validateDistanceInput,
  validateLocationName,
  validatePacingLocationInput,
  type DistanceUnit,
  type PacingLocationDefinition,
  type RaceCalculation,
  type ValidationError,
} from "../engine";
import { parseNumberText } from "./parse";

/**
 * Pacing-location state: plain data plus pure functions. No React in here.
 *
 * What is stored for each location is only what the coach entered: an id, a
 * name, a distance in METERS, and the unit they entered it in (so it can be
 * shown and edited the way they typed it). Target times are NOT stored; the
 * screen derives them from the calculated race (engine: resolvePacingLocations),
 * so a time can never be stale.
 *
 * Every function takes the current state and returns a NEW state; nothing is
 * mutated and there is no module-level state.
 */

/** A stored location. Satisfies the engine's PacingLocationDefinition, with the entry unit as an extra. */
export interface StoredLocation extends PacingLocationDefinition {
  unit: DistanceUnit;
}

export interface LocationsState {
  /** Insertion order. Display order is always by distance and is computed, never stored. */
  items: readonly StoredLocation[];
  /**
   * Next number to use in an id ("loc-7"). It only ever goes up, including past
   * deleted and cleared locations, so an id is never reused for a different location.
   */
  nextId: number;
  /** The most recently deleted location, kept so Undo can restore it (same id). */
  lastDeleted: StoredLocation | null;
}

export const INITIAL_LOCATIONS: LocationsState = { items: [], nextId: 1, lastDeleted: null };

/** What the add/edit form holds: text, exactly as typed. */
export interface LocationFormValues {
  name: string;
  distanceText: string;
  unit: DistanceUnit;
}

export type LocationField = "name" | "distance" | "general";
export type LocationErrors = Partial<Record<LocationField, string[]>>;

export type LocationOutcome =
  | { ok: true; state: LocationsState; id: string }
  | { ok: false; errors: LocationErrors };

export type RemoveOutcome = { ok: true; state: LocationsState } | { ok: false; errors: LocationErrors };

export type ImportOutcome =
  | { ok: true; state: LocationsState; added: number; skippedExisting: number; skippedFinish: number }
  | { ok: false; errors: LocationErrors };

export const NO_RACE_MESSAGE = "Calculate a race in the Calculator before creating pacing locations.";
export const FINISH_PROTECTED_MESSAGE =
  "The finish line is added automatically and can't be edited or deleted.";
export const NOT_FOUND_MESSAGE = "That location no longer exists.";

const failWith = (field: LocationField, message: string) => ({
  ok: false as const,
  errors: { [field]: [message] } as LocationErrors,
});

function addError(errors: LocationErrors, field: LocationField, message: string): void {
  errors[field] = [...(errors[field] ?? []), message];
}

function fieldFor(error: ValidationError): LocationField {
  if (error.field === LOCATION_NAME_FIELD) return "name";
  if (error.field === LOCATION_DISTANCE_FIELD) return "distance";
  return "general";
}

/**
 * Turn the form's text into a validated name + distance in meters.
 * Reading the text (is it a number?) happens here; every rule about the VALUES
 * (positive, inside the race, not a duplicate, name rules) comes from the engine.
 */
function checkForm(
  values: LocationFormValues,
  race: RaceCalculation,
  existing: readonly StoredLocation[],
  editingId?: string,
): { ok: true; name: string; distanceMeters: number } | { ok: false; errors: LocationErrors } {
  const errors: LocationErrors = {};

  let distanceMeters: number | undefined;
  const parsed = parseNumberText(values.distanceText, {
    empty: "Enter a distance from the start.",
    invalid: "Distance must be a number (for example 1200 or 1.5).",
  });
  if (!parsed.ok) {
    addError(errors, "distance", parsed.message);
  } else {
    const converted = validateDistanceInput(parsed.value, values.unit);
    if (converted.ok) distanceMeters = converted.value;
    else for (const error of converted.errors) addError(errors, "distance", error.message);
  }

  if (distanceMeters === undefined) {
    // The distance couldn't be read, so check the name alone and report both problems.
    const name = validateLocationName(values.name);
    if (!name.ok) for (const error of name.errors) addError(errors, "name", error.message);
    return { ok: false, errors };
  }

  const result = validatePacingLocationInput(
    { name: values.name, distanceMeters },
    { race, existing, ...(editingId !== undefined ? { editingId } : {}) },
  );
  if (!result.ok) {
    for (const error of result.errors) addError(errors, fieldFor(error), error.message);
    return { ok: false, errors };
  }
  return { ok: true, ...result.value };
}

export function addLocation(
  state: LocationsState,
  values: LocationFormValues,
  race: RaceCalculation | null,
): LocationOutcome {
  if (race === null) return failWith("general", NO_RACE_MESSAGE);

  const checked = checkForm(values, race, state.items);
  if (!checked.ok) return checked;

  const id = `loc-${state.nextId}`;
  const location: StoredLocation = {
    id,
    name: checked.name,
    distanceMeters: checked.distanceMeters,
    unit: values.unit,
  };
  return {
    ok: true,
    id,
    state: { items: [...state.items, location], nextId: state.nextId + 1, lastDeleted: null },
  };
}

/** Edit a location's name, distance and unit. The id never changes. The finish can't be edited. */
export function updateLocation(
  state: LocationsState,
  id: string,
  values: LocationFormValues,
  race: RaceCalculation | null,
): LocationOutcome {
  if (id === FINISH_LOCATION_ID) return failWith("general", FINISH_PROTECTED_MESSAGE);
  if (!state.items.some((item) => item.id === id)) return failWith("general", NOT_FOUND_MESSAGE);
  if (race === null) return failWith("general", NO_RACE_MESSAGE);

  const checked = checkForm(values, race, state.items, id);
  if (!checked.ok) return checked;

  const items = state.items.map((item) =>
    item.id === id
      ? { id, name: checked.name, distanceMeters: checked.distanceMeters, unit: values.unit }
      : item,
  );
  return { ok: true, id, state: { ...state, items, lastDeleted: null } };
}

/** Delete a location, remembering it for Undo. The finish can't be deleted. */
export function removeLocation(state: LocationsState, id: string): RemoveOutcome {
  if (id === FINISH_LOCATION_ID) return failWith("general", FINISH_PROTECTED_MESSAGE);
  const target = state.items.find((item) => item.id === id);
  if (!target) return failWith("general", NOT_FOUND_MESSAGE);
  return {
    ok: true,
    state: { ...state, items: state.items.filter((item) => item.id !== id), lastDeleted: target },
  };
}

/** Bring back the last deleted location with its original id. Any add/edit/import/delete replaces the undo slot. */
export function undoDelete(state: LocationsState): LocationsState {
  if (state.lastDeleted === null) return state;
  return { ...state, items: [...state.items, state.lastDeleted], lastDeleted: null };
}

/**
 * The unit an imported split is shown in: whole miles read as miles ("2 mi"),
 * everything else as meters. This matches the labels the split table uses.
 */
export function naturalUnitFor(distanceMeters: number): DistanceUnit {
  const miles = Math.round(fromMeters(distanceMeters, "mi"));
  return miles >= 1 && distancesEqual(distanceMeters, toMeters(miles, "mi")) ? "mi" : "m";
}

/**
 * Add the calculator's generated splits as independent locations.
 * Existing locations are left alone; splits already present (or the finish) are skipped.
 * The result is ordinary stored data with no link back to the split table.
 */
export function importSplits(state: LocationsState, race: RaceCalculation | null): ImportOutcome {
  if (race === null) return failWith("general", NO_RACE_MESSAGE);

  const plan = planSplitImport(race.splits, state.items, race);
  const summary = { skippedExisting: plan.skippedExisting, skippedFinish: plan.skippedFinish };
  if (plan.toAdd.length === 0) return { ok: true, state, added: 0, ...summary };

  let nextId = state.nextId;
  const added: StoredLocation[] = plan.toAdd.map((entry) => ({
    id: `loc-${nextId++}`,
    name: entry.name,
    distanceMeters: entry.distanceMeters,
    unit: naturalUnitFor(entry.distanceMeters),
  }));
  return {
    ok: true,
    added: added.length,
    ...summary,
    state: { items: [...state.items, ...added], nextId, lastDeleted: null },
  };
}

/** Remove every location. The id counter is kept so ids are never reused afterwards. */
export function clearLocations(state: LocationsState): LocationsState {
  return { items: [], nextId: state.nextId, lastDeleted: null };
}

/** A number as short text: up to 9 decimals, trailing zeros dropped, no exponent for ordinary values. */
function trimmed(value: number, maxDecimals: number): string {
  return Number(value.toFixed(maxDecimals)).toString();
}

/** The form values that reproduce a stored location, for pre-filling the edit form. */
export function locationToFormValues(location: StoredLocation): LocationFormValues {
  return {
    name: location.name,
    distanceText: trimmed(fromMeters(location.distanceMeters, location.unit), 9),
    unit: location.unit,
  };
}
