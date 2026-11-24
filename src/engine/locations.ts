import { distancesEqual, formatDistanceLabel } from "./distance";
import { targetTimeAtDistance } from "./pace";
import { fail, makeError, ok } from "./result";
import type {
  PacingLocation,
  RaceCalculation,
  Split,
  ValidationError,
  ValidationResult,
} from "./types";

/**
 * Pacing-location logic: where a coach wants to watch runners, and the target
 * passing time at each of those places.
 *
 * Design rule: a location is just a NAME and a DISTANCE. Its target time is
 * never stored; it is derived from the race (pace x distance) every time it is
 * needed. Because there is no stored copy, a location's time can never be left
 * over from an outdated calculation.
 *
 * Like the rest of the engine: distances are meters, times are seconds, nothing
 * is rounded, and nothing here depends on React.
 */

/** Reserved id of the automatically generated finish location. Stored locations never use it. */
export const FINISH_LOCATION_ID = "finish";
export const FINISH_LOCATION_NAME = "Finish";
export const MAX_LOCATION_NAME_LENGTH = 40;

/** The parts of a calculated race that location times depend on. A RaceCalculation fits. */
export type RaceTiming = Pick<
  RaceCalculation,
  "totalDistanceMeters" | "totalTimeSeconds" | "paceSecondsPerMile"
>;

/** What gets stored for a user-made location. Extra fields (e.g. a display unit) are allowed and preserved. */
export interface PacingLocationDefinition {
  id: string;
  name: string;
  distanceMeters: number;
}

/** A location with its derived target time. Compatible with the Phase 1 PacingLocation type. */
export interface ResolvedPacingLocation extends PacingLocation {
  isFinish: boolean;
}

/** Why a stored location doesn't fit the current race. */
export type OutOfRangeReason = "beyond-race" | "at-finish" | "invalid-distance";

/** Where a distance sits relative to the race: clearly before the finish, or one of the out-of-range reasons. */
export type LocationFit = "before-finish" | OutOfRangeReason;

export interface OutOfRangeLocation<T> {
  location: T;
  reason: OutOfRangeReason;
}

export interface ResolvedPacingLocations<T extends PacingLocationDefinition> {
  /** Stored locations that fit the race: ascending by distance, each with its target time. All are before the finish. */
  locations: Array<T & { targetTimeSeconds: number; isFinish: false }>;
  /** The automatic finish: total distance, exact total time. Always present. */
  finish: ResolvedPacingLocation;
  /**
   * Stored locations the current race can't use (typically after the race got
   * shorter). They are kept, not deleted, so the coach can fix or remove them.
   * They get NO target time.
   */
  outOfRange: Array<OutOfRangeLocation<T>>;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Where does this distance fall in a race of `totalDistanceMeters`?
 * "At the finish" uses the same 1 micrometer tolerance as the rest of the engine,
 * so a location typed as 4.828032 km still lands on the 3-mile finish.
 */
export function classifyLocationDistance(distanceMeters: number, totalDistanceMeters: number): LocationFit {
  if (!isPositiveFinite(distanceMeters)) return "invalid-distance";
  if (distancesEqual(distanceMeters, totalDistanceMeters)) return "at-finish";
  return distanceMeters < totalDistanceMeters ? "before-finish" : "beyond-race";
}

/**
 * Target passing time (seconds) at `distanceMeters` into the race.
 *
 *   - Before the finish: pace x distance, i.e. distance * pace / 1609.344.
 *     Every location is computed on its own straight from the pace, never from
 *     another location's time, so rounding error cannot accumulate.
 *   - At the finish: the race's exact total time. Going through the pace would
 *     be correct only to the last floating-point bit; the exact value is free.
 *
 * Throws RangeError for a distance that isn't positive, finite and within the
 * race. Callers validate first; extrapolating past the finish would be a silent lie.
 */
export function targetTimeAtLocation(distanceMeters: number, race: RaceTiming): number {
  const fit = classifyLocationDistance(distanceMeters, race.totalDistanceMeters);
  if (fit === "at-finish") return race.totalTimeSeconds;
  if (fit === "before-finish") return targetTimeAtDistance(distanceMeters, race.paceSecondsPerMile);
  throw new RangeError(
    `Distance ${distanceMeters} m is not a valid location in a ${race.totalDistanceMeters} m race (${fit}).`,
  );
}

function byDistanceThenId(a: PacingLocationDefinition, b: PacingLocationDefinition): number {
  return a.distanceMeters - b.distanceMeters || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Turn stored locations into what the screen shows for the current race:
 * sorted by distance (creation order is irrelevant), each with its target time,
 * plus the automatic finish, plus any stored locations that no longer fit.
 * Pure: the input array and its objects are not modified.
 */
export function resolvePacingLocations<T extends PacingLocationDefinition>(
  definitions: readonly T[],
  race: RaceTiming,
): ResolvedPacingLocations<T> {
  const locations: ResolvedPacingLocations<T>["locations"] = [];
  const outOfRange: ResolvedPacingLocations<T>["outOfRange"] = [];

  for (const definition of definitions) {
    const fit = classifyLocationDistance(definition.distanceMeters, race.totalDistanceMeters);
    if (fit === "before-finish") {
      locations.push({
        ...definition,
        targetTimeSeconds: targetTimeAtLocation(definition.distanceMeters, race),
        isFinish: false,
      });
    } else {
      outOfRange.push({ location: definition, reason: fit });
    }
  }

  locations.sort(byDistanceThenId);
  outOfRange.sort((a, b) => byDistanceThenId(a.location, b.location));

  return {
    locations,
    finish: {
      id: FINISH_LOCATION_ID,
      name: FINISH_LOCATION_NAME,
      distanceMeters: race.totalDistanceMeters,
      targetTimeSeconds: race.totalTimeSeconds,
      isFinish: true,
    },
    outOfRange,
  };
}

// ---------------------------------------------------------------------------
// Validation (single location, for the add/edit form)
// ---------------------------------------------------------------------------

export interface LocationValidationContext {
  race: RaceTiming;
  /** All stored locations. Used to refuse a second location at the same distance. */
  existing: readonly PacingLocationDefinition[];
  /** When editing, the id of the location being edited, so it isn't a duplicate of itself. */
  editingId?: string;
}

export interface LocationInput {
  name: unknown;
  distanceMeters: number;
}

/** Field names used in ValidationError.field, so a form can place each message. */
export const LOCATION_NAME_FIELD = "name";
export const LOCATION_DISTANCE_FIELD = "distance";

export function validateLocationName(name: unknown): ValidationResult<string> {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") {
    return fail([makeError("INVALID_NAME", LOCATION_NAME_FIELD, "Enter a name for this location.")]);
  }
  // Count characters, not UTF-16 units, so an emoji isn't counted twice.
  const length = Array.from(trimmed).length;
  if (length > MAX_LOCATION_NAME_LENGTH) {
    return fail([
      makeError(
        "INVALID_NAME",
        LOCATION_NAME_FIELD,
        `Names can be at most ${MAX_LOCATION_NAME_LENGTH} characters (this one is ${length}).`,
      ),
    ]);
  }
  return ok(trimmed);
}

export function validateLocationDistance(
  distanceMeters: number,
  context: LocationValidationContext,
): ValidationResult<number> {
  const { race, existing, editingId } = context;
  const total = formatDistanceLabel(race.totalDistanceMeters);
  const field = LOCATION_DISTANCE_FIELD;

  const fit = classifyLocationDistance(distanceMeters, race.totalDistanceMeters);
  if (fit === "invalid-distance") {
    return fail([makeError("INVALID_DISTANCE", field, "Distance must be a number greater than 0.")]);
  }
  if (fit === "at-finish") {
    return fail([
      makeError(
        "DUPLICATE_DISTANCE",
        field,
        `That is the finish line (${total}), which is added automatically. Enter a distance before the finish.`,
      ),
    ]);
  }
  if (fit === "beyond-race") {
    return fail([
      makeError(
        "BEYOND_RACE_DISTANCE",
        field,
        `${formatDistanceLabel(distanceMeters)} is beyond the ${total} race distance. Enter a distance before the finish.`,
      ),
    ]);
  }

  const clash = existing.find(
    (other) => other.id !== editingId && distancesEqual(other.distanceMeters, distanceMeters),
  );
  if (clash) {
    return fail([
      makeError(
        "DUPLICATE_DISTANCE",
        field,
        `"${clash.name}" is already at ${formatDistanceLabel(clash.distanceMeters)}. Edit that location or choose a different distance.`,
      ),
    ]);
  }
  return ok(distanceMeters);
}

/** Validate a whole add/edit form at once, reporting every problem rather than just the first. */
export function validatePacingLocationInput(
  input: LocationInput,
  context: LocationValidationContext,
): ValidationResult<{ name: string; distanceMeters: number }> {
  const errors: ValidationError[] = [];
  const name = validateLocationName(input.name);
  const distance = validateLocationDistance(input.distanceMeters, context);
  if (!name.ok) errors.push(...name.errors);
  if (!distance.ok) errors.push(...distance.errors);
  if (!name.ok || !distance.ok) return fail(errors);
  return ok({ name: name.value, distanceMeters: distance.value });
}

// ---------------------------------------------------------------------------
// Importing the calculator's splits as locations
// ---------------------------------------------------------------------------

export interface SplitImportPlan {
  /** New locations to create, in split order. Names come from the split labels ("400 m", "1 mile"). */
  toAdd: Array<{ name: string; distanceMeters: number }>;
  /** Splits skipped because a location already exists at that distance. */
  skippedExisting: number;
  /** Splits skipped because they are the finish, which is always present automatically. */
  skippedFinish: number;
}

/**
 * Decide which splits become new pacing locations. Nothing is linked: the
 * result is plain name+distance data, and target times are derived later from
 * the same pace the split table used, so they match the split times exactly.
 *
 * Importing twice adds nothing the second time, and existing (manual) locations
 * are never touched.
 */
export function planSplitImport(
  splits: readonly Split[],
  existing: readonly PacingLocationDefinition[],
  race: RaceTiming,
): SplitImportPlan {
  const plan: SplitImportPlan = { toAdd: [], skippedExisting: 0, skippedFinish: 0 };
  const taken: number[] = existing.map((location) => location.distanceMeters);

  for (const split of splits) {
    const fit = classifyLocationDistance(split.distanceMeters, race.totalDistanceMeters);
    if (split.isFinish || fit === "at-finish") {
      plan.skippedFinish += 1;
    } else if (fit !== "before-finish") {
      continue; // a split outside this race can't be a location; the calculator never produces one
    } else if (taken.some((distance) => distancesEqual(distance, split.distanceMeters))) {
      plan.skippedExisting += 1;
    } else {
      plan.toAdd.push({ name: split.label, distanceMeters: split.distanceMeters });
      taken.push(split.distanceMeters);
    }
  }
  return plan;
}
