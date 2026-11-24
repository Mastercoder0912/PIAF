import { validateDistanceInput, type DistanceUnit } from "../engine";

/**
 * Text-field parsing helpers. These only turn what a person typed into a
 * number; every actual rule (positive, in range, ...) is enforced by the engine.
 */

export type ParsedNumber = { ok: true; value: number } | { ok: false; message: string };

// Optional minus (so "-5" reaches the engine and gets its "greater than 0" message),
// digits with an optional decimal part, or a bare decimal like ".5". No exponents, no commas.
const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;

export function parseNumberText(
  text: string,
  messages: { empty: string; invalid: string },
): ParsedNumber {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, message: messages.empty };
  if (!NUMBER_PATTERN.test(trimmed)) return { ok: false, message: messages.invalid };
  return { ok: true, value: Number(trimmed) };
}

/** Race distance in meters, or null when the text/unit isn't a usable distance (no error details). */
export function distanceMetersOrNull(text: string, unit: DistanceUnit): number | null {
  const parsed = parseNumberText(text, { empty: "", invalid: "" });
  if (!parsed.ok) return null;
  const validated = validateDistanceInput(parsed.value, unit);
  return validated.ok ? validated.value : null;
}
