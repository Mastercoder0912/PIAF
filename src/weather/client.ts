import type { WeatherErrorCode, WeatherReport } from "./types";

/**
 * Browser side of the weather feature. It only ever talks to our own /api/weather endpoint,
 * never to WeatherAPI.com, so there is no key here. Everything the endpoint returns is checked
 * before it is shown, because an unexpected page (a host error, a 404 HTML page) must never
 * turn into garbage on screen.
 */

export const WEATHER_ENDPOINT = "/api/weather";
export const REQUEST_TIMEOUT_MS = 8000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
const PLACE_TEXT = /^[\p{L}\p{N} .,'’-]+$/u;

export type WeatherResult = { ok: true; report: WeatherReport } | { ok: false; error: WeatherErrorCode };

/** Tidy what the coach typed. Returns null if it is not something worth sending. Lower-cased so "Lubbock" and "lubbock" share a cache entry. */
export function normalizePlaceQuery(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < MIN_QUERY_LENGTH || text.length > MAX_QUERY_LENGTH) return null;
  if (!PLACE_TEXT.test(text)) return null;
  return text.toLowerCase();
}

/** "lat,lon" with two decimals (about 1 km): enough for weather, and the same shape the endpoint expects. */
export function positionQuery(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string";

export function isWeatherReport(value: unknown): value is WeatherReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isText(v.place) &&
    v.place.length > 0 &&
    isNumber(v.tempF) &&
    isNumber(v.tempC) &&
    isNumber(v.feelsLikeF) &&
    isNumber(v.feelsLikeC) &&
    isText(v.condition) &&
    v.condition.length > 0 &&
    isNumber(v.windMph) &&
    isNumber(v.windKph) &&
    isText(v.windDir) &&
    isNumber(v.humidity) &&
    isText(v.observedAt)
  );
}

function errorCodeOf(body: unknown): WeatherErrorCode {
  const code = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return code === "bad_query" || code === "not_found" ? code : "unavailable";
}

/** Ask our endpoint for the weather. Never throws: every failure becomes a plain error code. */
export async function fetchWeather(
  query: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<WeatherResult> {
  try {
    const response = await fetchImpl(`${WEATHER_ENDPOINT}?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null; // not JSON, for example an HTML error page
    }
    if (response.ok && isWeatherReport(body)) return { ok: true, report: body };
    return { ok: false, error: response.ok ? "unavailable" : errorCodeOf(body) };
  } catch {
    return { ok: false, error: "unavailable" }; // offline, blocked or timed out
  }
}

/** Small in-memory cache so switching screens or re-asking doesn't spend a request (and WeatherAPI quota). */
export class WeatherCache {
  private readonly entries = new Map<string, { report: WeatherReport; storedAt: number }>();

  constructor(private readonly ttlMs: number = CACHE_TTL_MS) {}

  get(query: string, now: number): WeatherReport | null {
    const entry = this.entries.get(query);
    if (!entry) return null;
    if (now - entry.storedAt >= this.ttlMs || now < entry.storedAt) {
      this.entries.delete(query);
      return null;
    }
    return entry.report;
  }

  set(query: string, report: WeatherReport, now: number): void {
    this.entries.delete(query);
    this.entries.set(query, { report, storedAt: now });
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
