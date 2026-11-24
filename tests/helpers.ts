import type { ValidationResult } from "../src/engine/types";

/** Unwrap an ok result, or fail the test with the validation errors printed. */
export function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got errors: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function errorCodes(result: ValidationResult<unknown>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

/** Indexed access that fails loudly instead of returning undefined. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index < 0 ? items.length + index : index];
  if (item === undefined) throw new Error(`No item at index ${index} (length ${items.length})`);
  return item;
}

/** Absolute tolerance for "should be exactly equal, modulo floating point" checks. */
export const EPS = 1e-9;
