import { fail, makeError, ok } from "./result";
import type { ValidationResult } from "./types";

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;

const LEADING_FIELD = /^\d{1,6}$/; // hours, or minutes when there are no hours
const TWO_DIGITS = /^\d{2}$/; // minutes after an hours field
const SECONDS_FIELD = /^\d{2}(\.\d+)?$/; // two-digit seconds, optional decimal part

const FORMAT_HINT = "Enter a time as MM:SS or HH:MM:SS (for example 19:45 or 1:05:30).";

function timeFormatError(field: string, message: string): ValidationResult<never> {
  return fail([makeError("INVALID_TIME_FORMAT", field, message)]);
}

/**
 * Parse "MM:SS" or "HH:MM:SS" into seconds.
 *
 * Rules:
 *   - Seconds must be two digits and < 60. A decimal part is allowed ("19:45.3").
 *   - With an hours field, minutes must be two digits and < 60.
 *   - Without hours, minutes may exceed 59 ("75:00" is 75 minutes).
 *   - A value of zero parses fine; whether zero is acceptable as a *target*
 *     is decided by validation, not by parsing.
 */
export function parseTimeString(input: string, field = "time"): ValidationResult<number> {
  if (typeof input !== "string") {
    return timeFormatError(field, FORMAT_HINT);
  }
  const text = input.trim();
  const parts = text.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    return timeFormatError(field, FORMAT_HINT);
  }

  const hasHours = parts.length === 3;
  const hoursText = hasHours ? parts[0] : undefined;
  const minutesText = parts[parts.length - 2] ?? "";
  const secondsText = parts[parts.length - 1] ?? "";

  if (hoursText !== undefined && !LEADING_FIELD.test(hoursText)) {
    return timeFormatError(field, `Hours "${hoursText}" must be a whole number. ${FORMAT_HINT}`);
  }
  if (!(hasHours ? TWO_DIGITS : LEADING_FIELD).test(minutesText)) {
    return timeFormatError(
      field,
      hasHours
        ? `Minutes "${minutesText}" must be two digits (for example 1:05:30). ${FORMAT_HINT}`
        : `Minutes "${minutesText}" must be a whole number. ${FORMAT_HINT}`,
    );
  }
  if (!SECONDS_FIELD.test(secondsText)) {
    return timeFormatError(
      field,
      `Seconds "${secondsText}" must be two digits (for example 5:07). ${FORMAT_HINT}`,
    );
  }

  const hours = hoursText === undefined ? 0 : Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  if (seconds >= SECONDS_PER_MINUTE) {
    return timeFormatError(field, `Seconds must be less than 60 (got ${secondsText}).`);
  }
  if (hasHours && minutes >= SECONDS_PER_MINUTE) {
    return timeFormatError(
      field,
      `Minutes must be less than 60 when hours are included (got ${minutesText}).`,
    );
  }

  return ok(hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds);
}

/**
 * Parse a pace entered as "MM:SS", meaning minutes and seconds PER MILE.
 * Returns seconds per mile. HH:MM:SS is rejected for pace: an hour-plus mile is
 * almost certainly a typo, and accepting it would silently produce a nonsense plan.
 */
export function parsePaceString(input: string, field = "pace"): ValidationResult<number> {
  const paceHint = "Enter pace as MM:SS per mile (for example 6:30).";
  if (typeof input !== "string" || input.trim().split(":").length !== 2) {
    return fail([makeError("INVALID_PACE", field, paceHint)]);
  }
  const parsed = parseTimeString(input, field);
  if (!parsed.ok) {
    return fail(parsed.errors.map((e) => ({ ...e, code: "INVALID_PACE" as const })));
  }
  if (parsed.value <= 0) {
    return fail([makeError("INVALID_PACE", field, `Pace must be greater than 0:00. ${paceHint}`)]);
  }
  return ok(parsed.value);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * Display-only formatter: "M:SS" under an hour, "H:MM:SS" otherwise.
 * `fractionDigits` (0-3) adds a decimal part to the seconds.
 *
 * Rounding happens ONCE on the total, before splitting into h/m/s. Rounding
 * each field separately is the classic bug that prints "1:60" for 119.6 s.
 *
 * Throws RangeError on negative / non-finite input: callers format values that
 * already passed validation, so bad input here is a programming error.
 */
export function formatDuration(totalSeconds: number, fractionDigits = 0): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`Cannot format duration: ${totalSeconds}`);
  }
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 3) {
    throw new RangeError(`fractionDigits must be an integer from 0 to 3 (got ${fractionDigits})`);
  }

  const scale = 10 ** fractionDigits;
  const roundedUnits = Math.round(totalSeconds * scale); // integer count of 1/scale seconds
  const wholeSeconds = Math.floor(roundedUnits / scale);
  const fraction = roundedUnits % scale;

  const hours = Math.floor(wholeSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = wholeSeconds % SECONDS_PER_MINUTE;

  const secondsText =
    fractionDigits === 0
      ? pad2(seconds)
      : `${pad2(seconds)}.${fraction.toString().padStart(fractionDigits, "0")}`;

  return hours > 0
    ? `${hours}:${pad2(minutes)}:${secondsText}`
    : `${minutes}:${secondsText}`;
}
