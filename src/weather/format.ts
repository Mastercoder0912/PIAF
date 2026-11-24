import type { WeatherReport } from "./types";

/** Display helpers for the weather card. Rounding is for display only. */

/** "71°F (22°C)" */
export function formatTemperature(fahrenheit: number, celsius: number): string {
  return `${Math.round(fahrenheit)}°F (${Math.round(celsius)}°C)`;
}

/** "8 mph NW", or just "8 mph" when the provider gave no usable direction. Calm air reads "Calm". */
export function formatWind(report: Pick<WeatherReport, "windMph" | "windKph" | "windDir">): string {
  const mph = Math.round(report.windMph);
  if (mph === 0) return "Calm";
  return `${mph} mph${report.windDir ? ` ${report.windDir}` : ""} (${Math.round(report.windKph)} km/h)`;
}

export function formatHumidity(percent: number): string {
  return `${Math.round(percent)}%`;
}

/**
 * The provider's "last updated" is local time at the place, like "2026-11-23 15:15".
 * Shown as "3:15 PM". Parsed by hand (no Date) so it never shifts into the coach's own time zone.
 * Returns null if the text isn't in that shape.
 */
export function formatObservedTime(observedAt: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2} (\d{1,2}):(\d{2})$/.exec(observedAt.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2];
  if (hour > 23 || Number(minute) > 59) return null;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}
