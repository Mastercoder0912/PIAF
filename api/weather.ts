import type { WeatherErrorBody, WeatherErrorCode, WeatherReport } from "../src/weather/types";

/**
 * Weather proxy (Vercel serverless function): GET /api/weather?q=<place>
 *
 * Why this exists: the WeatherAPI.com key must never reach the browser. The app calls this
 * endpoint; this endpoint reads the key from the server-side environment variable WEATHERAPI_KEY
 * and calls WeatherAPI.com. The key is never put in a response, a log line or the app bundle.
 *
 * `q` is either free text (city, ZIP/postal code) or "lat,lon" from the optional "Use my location"
 * button. The reply is a small, validated WeatherReport, or { error } with a plain category.
 *
 * Kept self-contained on purpose (type-only imports): a function that imports nothing at runtime
 * can't fail to bundle on the host.
 */

const UPSTREAM_URL = "https://api.weatherapi.com/v1/current.json";
const UPSTREAM_TIMEOUT_MS = 6000;

// Successful readings are shared by the host's CDN for 10 minutes. Errors are never cached.
const CACHE_OK = "public, max-age=60, s-maxage=600, stale-while-revalidate=300";
const CACHE_NONE = "no-store";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
// WeatherAPI's "no matching location found" code.
const UPSTREAM_NOT_FOUND = 1006;

const COORDINATES = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/;
// Letters (any language), digits, spaces and the punctuation found in place names and postal codes.
const PLACE_TEXT = /^[\p{L}\p{N} .,'’-]+$/u;
const COMPASS = /^[NESW]{1,3}$/;

type ParsedQuery = { ok: true; q: string } | { ok: false };

/** Accepts only what we would be happy to forward; the result is also normalised so equal places share a cache entry. */
function parseQuery(raw: string | null): ParsedQuery {
  const text = (raw ?? "").trim().replace(/\s+/g, " ");
  if (text.length < MIN_QUERY_LENGTH || text.length > MAX_QUERY_LENGTH) return { ok: false };

  const coordinates = COORDINATES.exec(text);
  if (coordinates) {
    const lat = Number(coordinates[1]);
    const lon = Number(coordinates[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false };
    }
    // Two decimals is about 1 km: plenty for weather, and it keeps a precise position out of the logs.
    return { ok: true, q: `${lat.toFixed(2)},${lon.toFixed(2)}` };
  }

  if (!PLACE_TEXT.test(text)) return { ok: false };
  return { ok: true, q: text.toLowerCase() };
}

function json(body: WeatherReport | WeatherErrorBody, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

function fail(error: WeatherErrorCode, status: number): Response {
  return json({ error }, status, CACHE_NONE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Turns WeatherAPI's reply into our small shape, or null if anything we rely on is missing or odd. */
function toReport(body: unknown): WeatherReport | null {
  if (!isRecord(body) || !isRecord(body.location) || !isRecord(body.current)) return null;
  const { location, current } = body;
  const condition = isRecord(current.condition) ? current.condition.text : undefined;

  const name = typeof location.name === "string" ? location.name.trim() : "";
  const region = typeof location.region === "string" ? location.region.trim() : "";
  const country = typeof location.country === "string" ? location.country.trim() : "";
  const place = [name, region || country].filter(Boolean).join(", ");

  if (
    !place ||
    typeof condition !== "string" ||
    !condition.trim() ||
    !finite(current.temp_f) ||
    !finite(current.temp_c) ||
    !finite(current.feelslike_f) ||
    !finite(current.feelslike_c) ||
    !finite(current.wind_mph) ||
    !finite(current.wind_kph) ||
    !finite(current.humidity) ||
    current.humidity < 0 ||
    current.humidity > 100 ||
    typeof current.last_updated !== "string"
  ) {
    return null;
  }

  return {
    place,
    tempF: current.temp_f,
    tempC: current.temp_c,
    feelsLikeF: current.feelslike_f,
    feelsLikeC: current.feelslike_c,
    condition: condition.trim(),
    windMph: current.wind_mph,
    windKph: current.wind_kph,
    windDir: typeof current.wind_dir === "string" && COMPASS.test(current.wind_dir) ? current.wind_dir : "",
    humidity: current.humidity,
    observedAt: current.last_updated,
  };
}

export async function GET(request: Request): Promise<Response> {
  const parsed = parseQuery(new URL(request.url).searchParams.get("q"));
  if (!parsed.ok) return fail("bad_query", 400);

  const key = process.env.WEATHERAPI_KEY;
  if (!key) {
    console.error("weather: WEATHERAPI_KEY is not set on the server");
    return fail("unavailable", 503);
  }

  const url = new URL(UPSTREAM_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", parsed.q);
  url.searchParams.set("aqi", "no");

  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (error) {
    // Log the kind of failure only. The error text can include the request URL, which contains the key.
    console.error(`weather: upstream request failed (${error instanceof Error ? error.name : "unknown"})`);
    return fail("unavailable", 502);
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  if (!upstream.ok) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
    if (code === UPSTREAM_NOT_FOUND) return fail("not_found", 404);
    // Anything else (bad or disabled key, quota used up, provider outage) is not the coach's fault.
    console.error(`weather: upstream returned HTTP ${upstream.status}, error code ${String(code ?? "none")}`);
    return fail("unavailable", 502);
  }

  const report = toReport(body);
  if (!report) {
    console.error("weather: upstream reply was missing expected fields");
    return fail("unavailable", 502);
  }
  return json(report, 200, CACHE_OK);
}
