import {
  calculateRace,
  parsePaceString,
  parseTimeString,
  toMeters,
  validateDistanceInput,
  type RaceCalculation,
  type RaceConfig,
  type ValidationError,
} from "../engine";
import type { FormState, TargetMode } from "./form";
import { parseNumberText } from "./parse";

/**
 * The only place the UI turns form text into an engine RaceConfig and calls
 * calculateRace(). No pace/split math lives here: this file parses, converts
 * units through the engine, and routes the engine's errors to form fields.
 */

export type FieldName = "distance" | "time" | "pace" | "interval" | "general";
export type FieldErrors = Partial<Record<FieldName, string[]>>;

/** Order used to decide which invalid field to focus first. */
export const FIELD_ORDER: readonly FieldName[] = ["distance", "time", "pace", "interval"];

export type BuildResult = { ok: true; config: RaceConfig } | { ok: false; errors: FieldErrors };

export type CalcSuccess = { config: RaceConfig; calculation: RaceCalculation };
export type CalcOutcome = ({ ok: true } & CalcSuccess) | { ok: false; errors: FieldErrors };

function addErrors(errors: FieldErrors, field: FieldName, messages: string[]): void {
  errors[field] = [...(errors[field] ?? []), ...messages];
}

/** Which form field an engine error belongs to. */
function fieldForEngineError(error: ValidationError, mode: TargetMode): FieldName {
  switch (error.field) {
    case "distance":
    case "totalDistanceMeters":
      return "distance";
    case "time":
    case "targetTimeSeconds":
      return "time";
    case "pace":
    case "targetPaceSecondsPerMile":
      return "pace";
    case "interval":
    case "intervalDistanceMeters":
      return "interval";
    case "target":
      return mode; // "time" | "pace" are also field names
    default:
      return "general";
  }
}

export function mapEngineErrors(errors: readonly ValidationError[], mode: TargetMode): FieldErrors {
  const mapped: FieldErrors = {};
  for (const error of errors) {
    addErrors(mapped, fieldForEngineError(error, mode), [error.message]);
  }
  return mapped;
}

/**
 * Phase 1 of validation: can every visible field be read as a number/time?
 * Reports ALL unreadable fields at once. Rules about values (zero, too many
 * splits, ...) are left to the engine in runCalculation.
 */
export function buildRaceConfig(form: FormState): BuildResult {
  const errors: FieldErrors = {};

  // Race distance -> meters
  let totalDistanceMeters: number | undefined;
  const distance = parseNumberText(form.distanceText, {
    empty: "Enter a race distance.",
    invalid: "Race distance must be a number (for example 5 or 3.1).",
  });
  if (!distance.ok) {
    addErrors(errors, "distance", [distance.message]);
  } else {
    const validated = validateDistanceInput(distance.value, form.distanceUnit);
    if (validated.ok) totalDistanceMeters = validated.value;
    else addErrors(errors, "distance", validated.errors.map((e) => e.message));
  }

  // Exactly one target, depending on the selected mode
  let targetTimeSeconds: number | undefined;
  let targetPaceSecondsPerMile: number | undefined;
  if (form.targetMode === "time") {
    const parsed = parseTimeString(form.timeText, "time");
    if (parsed.ok) targetTimeSeconds = parsed.value;
    else addErrors(errors, "time", parsed.errors.map((e) => e.message));
  } else {
    const parsed = parsePaceString(form.paceText, "pace");
    if (parsed.ok) targetPaceSecondsPerMile = parsed.value;
    else addErrors(errors, "pace", parsed.errors.map((e) => e.message));
  }

  // Manual interval -> meters (positivity is checked by the engine so its wording is used)
  let intervalDistanceMeters: number | undefined;
  if (form.intervalMode === "manual") {
    const interval = parseNumberText(form.intervalText, {
      empty: "Enter an interval distance.",
      invalid: "Interval must be a number (for example 400).",
    });
    if (interval.ok) intervalDistanceMeters = toMeters(interval.value, form.intervalUnit);
    else addErrors(errors, "interval", [interval.message]);
  }

  if (Object.keys(errors).length > 0 || totalDistanceMeters === undefined) {
    return { ok: false, errors };
  }

  const config: RaceConfig = {
    totalDistanceMeters,
    intervalMode: form.intervalMode,
  };
  if (targetTimeSeconds !== undefined) config.targetTimeSeconds = targetTimeSeconds;
  if (targetPaceSecondsPerMile !== undefined) config.targetPaceSecondsPerMile = targetPaceSecondsPerMile;
  if (intervalDistanceMeters !== undefined) config.intervalDistanceMeters = intervalDistanceMeters;
  return { ok: true, config };
}

/** Validate the form, call the engine, and return either splits or field-level errors. */
export function runCalculation(form: FormState): CalcOutcome {
  const built = buildRaceConfig(form);
  if (!built.ok) return built;

  const result = calculateRace(built.config);
  if (!result.ok) return { ok: false, errors: mapEngineErrors(result.errors, form.targetMode) };
  return { ok: true, config: built.config, calculation: result.value };
}

/** True when both configs describe the same race (used to detect stale results). */
export function sameConfig(a: BuildResult, b: RaceConfig): boolean {
  return a.ok && JSON.stringify(a.config) === JSON.stringify(b);
}
