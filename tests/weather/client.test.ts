import { describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  WeatherCache,
  fetchWeather,
  isWeatherReport,
  normalizePlaceQuery,
  positionQuery,
} from "../../src/weather/client";
import { getCurrentPosition } from "../../src/weather/geolocation";
import { formatHumidity, formatObservedTime, formatTemperature, formatWind } from "../../src/weather/format";
import type { WeatherReport } from "../../src/weather/types";

export const REPORT: WeatherReport = {
  place: "Lubbock, Texas",
  tempF: 71,
  tempC: 21.7,
  feelsLikeF: 70.2,
  feelsLikeC: 21.2,
  condition: "Partly cloudy",
  windMph: 8.1,
  windKph: 13,
  windDir: "NW",
  humidity: 45,
  observedAt: "2026-11-23 15:15",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("normalizePlaceQuery", () => {
  it("trims, collapses spaces and lower-cases so equal places share a cache entry", () => {
    expect(normalizePlaceQuery("  Lubbock,   TX ")).toBe("lubbock, tx");
    expect(normalizePlaceQuery("79401")).toBe("79401");
    expect(normalizePlaceQuery("SW1A 1AA")).toBe("sw1a 1aa");
    expect(normalizePlaceQuery("Saint-Étienne")).toBe("saint-étienne");
  });

  it.each(["", " ", "a", "a".repeat(81), "x&y=1", "<b>", "a/b", "a;b", "a?b"])("rejects %j", (text) => {
    expect(normalizePlaceQuery(text)).toBeNull();
  });
});

describe("positionQuery", () => {
  it("uses two decimals", () => {
    expect(positionQuery(33.5779, -101.8552)).toBe("33.58,-101.86");
    expect(positionQuery(0, 0)).toBe("0.00,0.00");
  });
});

describe("isWeatherReport", () => {
  it("accepts a complete report and rejects anything else", () => {
    expect(isWeatherReport(REPORT)).toBe(true);
    expect(isWeatherReport({ ...REPORT, windDir: "" })).toBe(true); // direction is optional
    expect(isWeatherReport(null)).toBe(false);
    expect(isWeatherReport("<html>")).toBe(false);
    expect(isWeatherReport({ ...REPORT, humidity: "45" })).toBe(false);
    expect(isWeatherReport({ ...REPORT, tempF: Number.NaN })).toBe(false);
    expect(isWeatherReport({ ...REPORT, place: "" })).toBe(false);
    const { condition: _omitted, ...withoutCondition } = REPORT;
    expect(isWeatherReport(withoutCondition)).toBe(false);
  });
});

describe("fetchWeather", () => {
  it("asks our own endpoint (never the provider) with the place encoded", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json(REPORT));
    const result = await fetchWeather("lubbock, tx", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, report: REPORT });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/api/weather?q=lubbock%2C%20tx");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("weatherapi.com");
  });

  it.each([
    ["not_found", 404],
    ["bad_query", 400],
    ["unavailable", 502],
  ])("passes through the %s category", async (error, status) => {
    const fetchImpl = async () => json({ error }, status);
    expect(await fetchWeather("x", fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, error });
  });

  it("treats everything unexpected as unavailable, and never throws", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => new Response("<html>Not found</html>", { status: 404 }),
      async () => new Response("<html>Hello</html>", { status: 200 }),
      async () => json({ error: "something_new" }, 500),
      async () => json({ place: "x" }, 200),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const makeResponse of cases) {
      expect(await fetchWeather("x", makeResponse as unknown as typeof fetch)).toEqual({ ok: false, error: "unavailable" });
    }
  });

  it("gives the request a time limit", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json(REPORT));
    await fetchWeather("x", fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("WeatherCache", () => {
  it("returns a stored report until it is 10 minutes old", () => {
    const cache = new WeatherCache();
    cache.set("a", REPORT, 1000);
    expect(cache.get("a", 1000)).toBe(REPORT);
    expect(cache.get("a", 1000 + CACHE_TTL_MS - 1)).toBe(REPORT);
    expect(cache.get("a", 1000 + CACHE_TTL_MS)).toBeNull();
    expect(cache.get("a", 1000)).toBeNull(); // expired entries are gone for good
  });

  it("does not return an entry from the future (clock moved backwards)", () => {
    const cache = new WeatherCache();
    cache.set("a", REPORT, 5000);
    expect(cache.get("a", 1000)).toBeNull();
  });

  it("keeps places apart and forgets the oldest beyond 20 entries", () => {
    const cache = new WeatherCache();
    for (let i = 0; i < 21; i++) cache.set(`place-${i}`, { ...REPORT, place: `P${i}` }, 0);
    expect(cache.get("place-0", 1)).toBeNull();
    expect(cache.get("place-1", 1)?.place).toBe("P1");
    expect(cache.get("place-20", 1)?.place).toBe("P20");
  });

  it("clear() empties it", () => {
    const cache = new WeatherCache();
    cache.set("a", REPORT, 0);
    cache.clear();
    expect(cache.get("a", 1)).toBeNull();
  });
});

describe("formatting", () => {
  it("shows both temperature scales, rounded for display only", () => {
    expect(formatTemperature(71, 21.7)).toBe("71°F (22°C)");
    expect(formatTemperature(70.2, 21.2)).toBe("70°F (21°C)");
    expect(formatTemperature(-3.6, -19.8)).toBe("-4°F (-20°C)");
    expect(formatTemperature(-0.2, -17.9)).toBe("0°F (-18°C)");
  });

  it("shows wind speed with direction, and says Calm when there is none", () => {
    expect(formatWind({ windMph: 8.1, windKph: 13, windDir: "NW" })).toBe("8 mph NW (13 km/h)");
    expect(formatWind({ windMph: 12.5, windKph: 20.1, windDir: "" })).toBe("13 mph (20 km/h)");
    expect(formatWind({ windMph: 0.4, windKph: 0.6, windDir: "N" })).toBe("Calm");
  });

  it("shows humidity as a whole percent", () => {
    expect(formatHumidity(45)).toBe("45%");
    expect(formatHumidity(44.6)).toBe("45%");
  });

  it("shows the provider's local reading time in 12-hour form without time zone shifting", () => {
    expect(formatObservedTime("2026-11-23 15:15")).toBe("3:15 PM");
    expect(formatObservedTime("2026-11-23 00:05")).toBe("12:05 AM");
    expect(formatObservedTime("2026-11-23 12:00")).toBe("12:00 PM");
    expect(formatObservedTime("2026-11-23 9:30")).toBe("9:30 AM");
    expect(formatObservedTime("2026-11-23 23:59")).toBe("11:59 PM");
    expect(formatObservedTime("yesterday")).toBeNull();
    expect(formatObservedTime("2026-11-23 24:00")).toBeNull();
    expect(formatObservedTime("2026-11-23 10:75")).toBeNull();
  });
});

describe("getCurrentPosition", () => {
  it("reports an unsupported browser", async () => {
    // @ts-expect-error: simulating a browser without geolocation
    expect(await getCurrentPosition(null)).toEqual({ ok: false, error: "location_unsupported" });
  });

  it("returns the coordinates when allowed, using a quick low-accuracy request", async () => {
    const getPosition = vi.fn((ok: PositionCallback, _fail?: PositionErrorCallback | null, _options?: PositionOptions) =>
      ok({ coords: { latitude: 33.5779, longitude: -101.8552 } } as GeolocationPosition),
    );
    expect(await getCurrentPosition({ getCurrentPosition: getPosition })).toEqual({ ok: true, latitude: 33.5779, longitude: -101.8552 });
    expect(getPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: false, timeout: 10_000 });
  });

  it("tells a refusal apart from other failures", async () => {
    const failWith = (code: number) => ({
      getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code } as GeolocationPositionError),
    });
    expect(await getCurrentPosition(failWith(1))).toEqual({ ok: false, error: "location_denied" });
    expect(await getCurrentPosition(failWith(2))).toEqual({ ok: false, error: "location_failed" });
    expect(await getCurrentPosition(failWith(3))).toEqual({ ok: false, error: "location_failed" });
  });
});
