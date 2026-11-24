import type { ValidationError, ValidationErrorCode, ValidationResult } from "./types";

/** Tiny helpers so every module builds ValidationResult values the same way. */

export function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(errors: ValidationError[]): ValidationResult<T> {
  return { ok: false, errors };
}

export function makeError(
  code: ValidationErrorCode,
  field: string,
  message: string,
): ValidationError {
  return { code, field, message };
}
