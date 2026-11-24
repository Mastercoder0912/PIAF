import {
  DISTANCE_TOLERANCE_METERS,
  METERS_PER_MILE,
  DISTANCE_UNITS,
  distancesEqual,
  formatDistanceLabel,
  isDistanceUnit,
  toMeters,
} from "./distance";
import { fail, makeError, ok } from "./result";
import type {
  DistanceUnit,
  PacingLocation,
  RaceConfig,
  Split,
  ValidationError,
  ValidationResult,
} from "./types";

/**
 * Safety cap on how many splits one race may produce. Without it, a typo like
 * "0.001 m" on a 10K would try to build ten million splits and freeze the UI.
 */
export const MAX_SPLITS = 10_000;

/**
 * Automatic mode: at most 8 sub-mile markers + finish up to one mile, then whole-mile markers + finish.
 * Upper bound (see automaticMarkerDistances for the exact rules).
 */
export function estimateAutomaticSplitCount(totalDistanceMeters: number): number {
  return Math.max(9, 1 + Math.floor(totalDistanceMeters / METERS_PER_MILE));
}

/** Manual mode: one marker per interval, the last of which is the finish. Upper bound. */
export function estimateManualSplitCount(
  totalDistanceMeters: number,
  intervalDistanceMeters: number,
): number {
  return Math.ceil(totalDistanceMeters / intervalDistanceMeters);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/** Validate a unit string coming from a form / JSON / untyped caller. */
export function validateDistanceUnit(unit: unknown): ValidationResult<DistanceUnit> {
  if (!isDistanceUnit(unit)) {
    return fail([
      makeError(
        "INVALID_DISTANCE_UNIT",
        "unit",
        `"${String(unit)}" is not a supported distance unit. Use ${DISTANCE_UNITS.map((u) => `"${u}"`).join(", ")}.`,
      ),
    ]);
  }
  return ok(unit);
}

/** Validate a user-entered distance + unit, returning the distance in METERS. */
export function validateDistanceInput(value: number, unit: unknown): ValidationResult<number> {
  const errors: ValidationError[] = [];
  const unitResult = validateDistanceUnit(unit);
  if (!unitResult.ok) errors.push(...unitResult.errors);
  if (!isPositiveFinite(value)) {
    errors.push(makeError("INVALID_DISTANCE", "distance", "Distance must be a number greater than 0."));
  }
  if (errors.length > 0 || !unitResult.ok) return fail(errors);
  return ok(toMeters(value, unitResult.value));
}

/**
 * Validate a RaceConfig. Reports ALL problems at once (not just the first) so a
 * form can highlight every bad field in one pass.
 */
export function validateRaceConfig(config: RaceConfig): ValidationResult<RaceConfig> {
  const errors: ValidationError[] = [];

  const distanceValid = isPositiveFinite(config.totalDistanceMeters);
  if (!distanceValid) {
    errors.push(
      makeError(
        "INVALID_DISTANCE",
        "totalDistanceMeters",
        "Race distance must be a number greater than 0.",
      ),
    );
  }

  // Exactly one target: time XOR pace.
  const hasTime = isPresent(config.targetTimeSeconds);
  const hasPace = isPresent(config.targetPaceSecondsPerMile);
  if (!hasTime && !hasPace) {
    errors.push(
      makeError("MISSING_TARGET", "target", "Enter either a target time or a target pace."),
    );
  } else if (hasTime && hasPace) {
    errors.push(
      makeError(
        "CONFLICTING_TARGETS",
        "target",
        "Enter either a target time or a target pace, not both.",
      ),
    );
  }
  if (hasTime && !isPositiveFinite(config.targetTimeSeconds)) {
    errors.push(
      makeError("INVALID_TIME", "targetTimeSeconds", "Target time must be greater than 0 seconds."),
    );
  }
  if (hasPace && !isPositiveFinite(config.targetPaceSecondsPerMile)) {
    errors.push(
      makeError(
        "INVALID_PACE",
        "targetPaceSecondsPerMile",
        "Target pace must be greater than 0 seconds per mile.",
      ),
    );
  }

  // Interval settings.
  if (config.intervalMode === "manual") {
    if (!isPositiveFinite(config.intervalDistanceMeters)) {
      errors.push(
        makeError(
          "INVALID_INTERVAL",
          "intervalDistanceMeters",
          "Custom interval must be a number of meters greater than 0.",
        ),
      );
    } else if (distanceValid) {
      const count = estimateManualSplitCount(config.totalDistanceMeters, config.intervalDistanceMeters);
      if (count > MAX_SPLITS) {
        errors.push(
          makeError(
            "TOO_MANY_SPLITS",
            "intervalDistanceMeters",
            `An interval of ${config.intervalDistanceMeters} m over ${config.totalDistanceMeters} m would create ${count} splits (maximum ${MAX_SPLITS}). Use a larger interval.`,
          ),
        );
      }
    }
  } else if (config.intervalMode === "automatic") {
    if (distanceValid) {
      const count = estimateAutomaticSplitCount(config.totalDistanceMeters);
      if (count > MAX_SPLITS) {
        errors.push(
          makeError(
            "TOO_MANY_SPLITS",
            "totalDistanceMeters",
            `Automatic intervals would create about ${count} splits (maximum ${MAX_SPLITS}). Use a custom interval instead.`,
          ),
        );
      }
    }
  } else {
    errors.push(
      makeError(
        "INVALID_INTERVAL_MODE",
        "intervalMode",
        `Interval mode must be "automatic" or "manual" (got "${String(config.intervalMode)}").`,
      ),
    );
  }

  return errors.length > 0 ? fail(errors) : ok(config);
}

interface DistancePoint {
  id: string;
  distanceMeters: number;
}

/**
 * Checks shared by splits and pacing locations: usable distance, inside the
 * race, unique id, and no two points at the same distance.
 */
function checkDistancePoints(
  points: readonly DistancePoint[],
  totalDistanceMeters: number,
  kind: "split" | "pacing location",
  collection: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const usable: { index: number; distanceMeters: number }[] = [];

  points.forEach((point, index) => {
    const field = `${collection}[${index}].distanceMeters`;
    if (!isPositiveFinite(point.distanceMeters)) {
      errors.push(
        makeError("INVALID_DISTANCE", field, `A ${kind} distance must be a number greater than 0.`),
      );
    } else if (point.distanceMeters > totalDistanceMeters + DISTANCE_TOLERANCE_METERS) {
      errors.push(
        makeError(
          "BEYOND_RACE_DISTANCE",
          field,
          `A ${kind} at ${formatDistanceLabel(point.distanceMeters)} is beyond the ${formatDistanceLabel(totalDistanceMeters)} race distance.`,
        ),
      );
    } else {
      usable.push({ index, distanceMeters: point.distanceMeters });
    }

    if (typeof point.id !== "string" || point.id === "") {
      errors.push(makeError("DUPLICATE_ID", `${collection}[${index}].id`, `Each ${kind} needs a non-empty id.`));
    } else if (seenIds.has(point.id)) {
      errors.push(
        makeError("DUPLICATE_ID", `${collection}[${index}].id`, `Two ${kind}s share the id "${point.id}".`),
      );
    } else {
      seenIds.add(point.id);
    }
  });

  // Sort so near-equal distances become neighbours, then compare neighbours.
  const sorted = [...usable].sort((a, b) => a.distanceMeters - b.distanceMeters);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && distancesEqual(previous.distanceMeters, current.distanceMeters)) {
      errors.push(
        makeError(
          "DUPLICATE_DISTANCE",
          `${collection}[${current.index}].distanceMeters`,
          `Two ${kind}s are at the same distance (${formatDistanceLabel(current.distanceMeters)}).`,
        ),
      );
    }
  }
  return errors;
}

/** Validate a list of pacing locations against the race distance. */
export function validatePacingLocations(
  locations: readonly PacingLocation[],
  totalDistanceMeters: number,
): ValidationResult<readonly PacingLocation[]> {
  if (!isPositiveFinite(totalDistanceMeters)) {
    return fail([
      makeError("INVALID_DISTANCE", "totalDistanceMeters", "Race distance must be a number greater than 0."),
    ]);
  }
  const errors = checkDistancePoints(locations, totalDistanceMeters, "pacing location", "locations");
  locations.forEach((location, index) => {
    if (typeof location.name !== "string" || location.name.trim() === "") {
      errors.push(makeError("INVALID_NAME", `locations[${index}].name`, "Each pacing location needs a name."));
    }
    if (!isPositiveFinite(location.targetTimeSeconds)) {
      errors.push(
        makeError(
          "INVALID_TIME",
          `locations[${index}].targetTimeSeconds`,
          "A pacing location's target time must be greater than 0 seconds.",
        ),
      );
    }
  });
  return errors.length > 0 ? fail(errors) : ok(locations);
}

/** Validate a list of splits (range, unique ids, no duplicate distances). */
export function validateSplits(
  splits: readonly Split[],
  totalDistanceMeters: number,
): ValidationResult<readonly Split[]> {
  if (!isPositiveFinite(totalDistanceMeters)) {
    return fail([
      makeError("INVALID_DISTANCE", "totalDistanceMeters", "Race distance must be a number greater than 0."),
    ]);
  }
  const errors = checkDistancePoints(splits, totalDistanceMeters, "split", "splits");
  return errors.length > 0 ? fail(errors) : ok(splits);
}
