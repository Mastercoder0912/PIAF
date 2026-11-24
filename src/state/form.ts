import {
  formatDuration,
  parsePaceString,
  parseTimeString,
  resolveRaceTarget,
  type DistanceUnit,
  type IntervalMode,
} from "../engine";
import { distanceMetersOrNull } from "./parse";

export type TargetMode = "time" | "pace";

/**
 * Everything the coach has typed or selected. Values stay as TEXT until
 * Calculate is pressed; nothing here is a calculation result.
 */
export interface FormState {
  distanceText: string;
  distanceUnit: DistanceUnit;

  targetMode: TargetMode;
  timeText: string;
  paceText: string;
  /** True when the field was auto-filled by a mode switch rather than typed. */
  timeDerived: boolean;
  paceDerived: boolean;

  intervalMode: IntervalMode;
  intervalText: string;
  intervalUnit: DistanceUnit;
}

export const INITIAL_FORM: FormState = {
  distanceText: "",
  distanceUnit: "km",
  targetMode: "time",
  timeText: "",
  paceText: "",
  timeDerived: false,
  paceDerived: false,
  intervalMode: "automatic",
  intervalText: "",
  intervalUnit: "m",
};

export type EditableTextField = "distanceText" | "timeText" | "paceText" | "intervalText";

export type FormAction =
  | { type: "editText"; field: EditableTextField; value: string }
  | { type: "setDistanceUnit"; unit: DistanceUnit }
  | { type: "setIntervalUnit"; unit: DistanceUnit }
  | { type: "setTargetMode"; mode: TargetMode }
  | { type: "setIntervalMode"; mode: IntervalMode }
  | { type: "setInterval"; text: string; unit: DistanceUnit }
  | { type: "reset" };

/**
 * Digits used when a mode switch pre-fills the other field. Three decimals keeps
 * the round trip (time -> pace -> time) accurate to well under the 0.05 s the
 * UI displays, for races up to ~100 miles. It's an editable text field, so the
 * coach can always overwrite it.
 */
const CONVERSION_FRACTION_DIGITS = 3;

/**
 * Switch between Target Time and Target Pace, carrying the current goal over:
 * the other field is pre-filled with the equivalent value (using the engine's
 * resolveRaceTarget) unless the coach already typed something there.
 * If the current inputs can't be read, nothing is converted and nothing is lost.
 */
export function switchTargetMode(form: FormState, mode: TargetMode): FormState {
  if (mode === form.targetMode) return form;
  const next: FormState = { ...form, targetMode: mode };

  const distanceMeters = distanceMetersOrNull(form.distanceText, form.distanceUnit);
  if (distanceMeters === null) return next;

  if (form.targetMode === "time") {
    // time -> pace
    const parsed = parseTimeString(form.timeText);
    const canFill = form.paceText.trim() === "" || form.paceDerived;
    if (!parsed.ok || parsed.value <= 0 || !canFill) return next;
    const { paceSecondsPerMile } = resolveRaceTarget(distanceMeters, { targetTimeSeconds: parsed.value });
    const text = formatDuration(paceSecondsPerMile, CONVERSION_FRACTION_DIGITS);
    // A pace the pace parser can't read (e.g. over an hour per mile) is not worth pre-filling.
    if (!parsePaceString(text).ok) return next;
    return { ...next, paceText: text, paceDerived: true };
  }

  // pace -> time
  const parsed = parsePaceString(form.paceText);
  const canFill = form.timeText.trim() === "" || form.timeDerived;
  if (!parsed.ok || !canFill) return next;
  const { totalTimeSeconds } = resolveRaceTarget(distanceMeters, { targetPaceSecondsPerMile: parsed.value });
  const text = formatDuration(totalTimeSeconds, CONVERSION_FRACTION_DIGITS);
  if (!parseTimeString(text).ok) return next;
  return { ...next, timeText: text, timeDerived: true };
}

export function formReducer(form: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "editText":
      return {
        ...form,
        [action.field]: action.value,
        // Typing in a field means it is the coach's own value, not a conversion.
        ...(action.field === "timeText" ? { timeDerived: false } : {}),
        ...(action.field === "paceText" ? { paceDerived: false } : {}),
      };
    case "setDistanceUnit":
      return { ...form, distanceUnit: action.unit };
    case "setIntervalUnit":
      return { ...form, intervalUnit: action.unit };
    case "setTargetMode":
      return switchTargetMode(form, action.mode);
    case "setIntervalMode":
      return { ...form, intervalMode: action.mode };
    case "setInterval":
      return { ...form, intervalText: action.text, intervalUnit: action.unit };
    case "reset":
      return INITIAL_FORM;
  }
}

/**
 * "Meaningful" changes = the coach has typed a value somewhere. Merely flipping
 * a unit or a mode toggle isn't worth a confirmation prompt on reset.
 */
export function hasMeaningfulChanges(form: FormState): boolean {
  return [form.distanceText, form.timeText, form.paceText, form.intervalText].some(
    (text) => text.trim() !== "",
  );
}
