import { formatDuration } from "../engine/time";

/** "6:26 /mi" from seconds per mile (rounded to the second; display only). */
export function formatPacePerMile(secondsPerMile: number): string {
  return `${formatDuration(secondsPerMile, 0)} /mi`;
}

/** "38 seconds" or "1 min 5 s": a plain-words length of time for a difference. Rounds once, then splits. */
export function formatSpan(seconds: number): string {
  const whole = Math.round(Math.abs(seconds));
  if (whole < 60) return `${whole} second${whole === 1 ? "" : "s"}`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** One sentence comparing the estimate with the flat target. Under half a second is called "about the same". */
export function describeDifference(differenceSeconds: number, originalSeconds: number): string {
  if (Math.abs(differenceSeconds) < 0.5) return "About the same as the flat target.";
  const percent = ((Math.abs(differenceSeconds) / originalSeconds) * 100).toFixed(1);
  const direction = differenceSeconds > 0 ? "slower" : "faster";
  return `About ${formatSpan(differenceSeconds)} ${direction} than the flat target (${percent}%).`;
}

/** "+13 s" / "-4 s" / "0 s" for a table cell; rounds to whole seconds. */
export function formatSigned(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole === 0) return "0 s";
  return `${whole > 0 ? "+" : "-"}${Math.abs(whole)} s`;
}
