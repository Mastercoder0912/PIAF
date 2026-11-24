import { snapMicros } from "./comparison";

/**
 * Display-only formatting for Live Pacer. Nothing here feeds back into a calculation.
 *
 * Rounding choices (each value is rounded once, at display time):
 *  - Stopwatch and ACTUAL times are TRUNCATED to hundredths, like a real stopwatch, so the
 *    recorded time reads exactly what the stopwatch showed when Record was pressed.
 *  - TARGET times and DIFFERENCES are rounded to the NEAREST hundredth.
 * Values are first snapped to whole microseconds so binary floating-point noise
 * (e.g. 287.99999999999994 for a true 288.0) can't make a time read 0.01 low.
 */

const MICROS_PER_HUNDREDTH = 10_000;

type Rounding = "truncate" | "nearest";

function toHundredths(seconds: number, rounding: Rounding): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Cannot format time: ${seconds}`);
  }
  const micros = Math.round(snapMicros(seconds) * 1e6); // exact integer
  return rounding === "truncate"
    ? Math.floor(micros / MICROS_PER_HUNDREDTH)
    : Math.round(micros / MICROS_PER_HUNDREDTH);
}

const pad2 = (n: number) => n.toString().padStart(2, "0");

function render(totalHundredths: number, padLeadingUnit: boolean): string {
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const tail = `${pad2(seconds)}.${pad2(hundredths)}`;
  if (hours > 0) {
    return `${padLeadingUnit ? pad2(hours) : hours}:${pad2(minutes)}:${tail}`;
  }
  return `${padLeadingUnit ? pad2(minutes) : minutes}:${tail}`;
}

/** Stopwatch face: "MM:SS.hh", or "HH:MM:SS.hh" from one hour. Truncated. */
export function formatStopwatch(seconds: number): string {
  return render(toHundredths(seconds, "truncate"), true);
}

/** A target passing time: "M:SS.hh" or "H:MM:SS.hh". Nearest hundredth. */
export function formatTargetTime(seconds: number): string {
  return render(toHundredths(seconds, "nearest"), false);
}

/** A recorded (actual) passing time: "M:SS.hh" or "H:MM:SS.hh". Truncated, matching the stopwatch. */
export function formatActualTime(seconds: number): string {
  return render(toHundredths(seconds, "truncate"), false);
}

/** "+2.25s" (behind), "-1.50s" (ahead), "0.00s" when it rounds to zero. Nearest hundredth. */
export function formatSignedDifference(differenceSeconds: number): string {
  if (!Number.isFinite(differenceSeconds)) throw new RangeError(`Cannot format difference: ${differenceSeconds}`);
  const hundredths = toHundredths(Math.abs(differenceSeconds), "nearest");
  const magnitude = `${Math.floor(hundredths / 100)}.${pad2(hundredths % 100)}s`;
  if (hundredths === 0) return magnitude;
  return `${differenceSeconds < 0 ? "-" : "+"}${magnitude}`;
}

/** Plain-language form for screen readers and summaries: "1.50 seconds ahead". */
export function describeDifference(differenceSeconds: number, status: "ahead" | "on-target" | "behind"): string {
  const hundredths = toHundredths(Math.abs(differenceSeconds), "nearest");
  const amount = `${Math.floor(hundredths / 100)}.${pad2(hundredths % 100)} seconds`;
  if (status === "on-target") return hundredths === 0 ? "exactly on target" : `on target (${amount} ${differenceSeconds < 0 ? "ahead" : "behind"})`;
  return `${amount} ${status}`;
}
