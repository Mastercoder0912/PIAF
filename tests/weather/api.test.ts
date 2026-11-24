import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/weather";
import type { WeatherReport } from "../../src/weather/types";

const KEY = "test-key-abc123-SECRET";

/** What WeatherAPI.com's current.json returns (only the fields that matter, plus noise the proxy must drop). */
function upstreamBody(overrides: { location?: object; current?: object } = {}) {
  return {
    location: { name: "Lubbock", region: "Texas", country: "United States of America", lat: 33.58, lon: -101.88, localtime: "2026-11-23 15:20", ...overrides.location },
    current: {
      last_updated: "2026-11-23 15:15",
      temp_c: 21.7,
      temp_f: 71,
      condition: { text: "Partly cloudy ", icon: "//cdn.weatherapi.com/weather/64x64/day/116.png", code: 1003 },
      wind_mph: 8.1,
      wind_kph: 13,
      wind_degree: 315,
      wind_dir: "NW",
      humidity: 45,
      feelslike_c: 21.2,
      feelslike_f: 70.2,
      uv: 3,
      ...overrides.current,
    },
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function call(query: string | null) {
  const url = query === null ? "https://app.test/api/weather" : `https://app.test/api/weather?q=${encodeURIComponent(query)}`;
  return GET(new Request(url));
}

let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("WEATHERAPI_KEY", KEY);
  fetchMock = vi.fn(async () => reply(upstreamBody()));
  vi.stubGlobal("fetch", fetchMock);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function upstreamUrl(): URL {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

describe("weather proxy: a successful lookup", () => {
  it("calls WeatherAPI.com current.json with the server-side key and the place", async () => {
    await call("Lubbock, TX");
    const url = upstreamUrl();
    expect(url.origin + url.pathname).toBe("https://api.weatherapi.com/v1/current.json");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(url.searchParams.get("q")).toBe("lubbock, tx");
    expect(url.searchParams.get("aqi")).toBe("no");
  });

  it("returns only the small report the app shows", async () => {
    const response = await call("Lubbock");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const report = (await response.json()) as WeatherReport;
    expect(report).toEqual({
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
    });
  });

  it("never puts the API key in a response", async () => {
    for (const q of ["Lubbock", "nowhere-land"]) {
      const response = await call(q);
      expect(await response.text()).not.toContain(KEY);
      expect(JSON.stringify([...response.headers.entries()])).not.toContain(KEY);
    }
  });

  it("lets the host's CDN cache a good reading for 10 minutes", async () => {
    const response = await call("Lubbock");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=600");
  });

  it("uses the country when a place has no region", async () => {
    fetchMock.mockResolvedValueOnce(reply(upstreamBody({ location: { name: "Paris", region: "", country: "France" } })));
    const report = (await (await call("Paris")).json()) as WeatherReport;
    expect(report.place).toBe("Paris, France");
  });

  it("drops a wind direction that is not a compass point", async () => {
    fetchMock.mockResolvedValueOnce(reply(upstreamBody({ current: { wind_dir: "up" } })));
    const report = (await (await call("Lubbock")).json()) as WeatherReport;
    expect(report.windDir).toBe("");
  });

  it("gives the provider a time limit", async () => {
    await call("Lubbock");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("weather proxy: what it accepts", () => {
  it("normalises a position to two decimals before forwarding (about 1 km)", async () => {
    await call("33.5779, -101.8552");
    expect(upstreamUrl().searchParams.get("q")).toBe("33.58,-101.86");
  });

  it("accepts ZIP codes, postal codes and accented names", async () => {
    for (const q of ["79401", "SW1A 1AA", "Saint-Étienne", "O'Fallon, MO"]) {
      fetchMock.mockClear();
      expect((await call(q)).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["no q at all", null],
    ["empty", ""],
    ["blank", "   "],
    ["one character", "a"],
    ["81 characters", "a".repeat(81)],
    ["URL parameter injection", "lubbock&key=other"],
    ["markup", "<script>alert(1)</script>"],
    ["a path", "../../etc/passwd"],
    ["latitude out of range", "91.0,10"],
    ["longitude out of range", "10,181"],
  ])("rejects %s without calling the provider", async (_label, q) => {
    const response = await call(q);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_query" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("weather proxy: when something goes wrong", () => {
  it("says so plainly if the server has no key, and does not call the provider", async () => {
    vi.stubEnv("WEATHERAPI_KEY", "");
    const response = await call("Lubbock");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unknown place as not_found (and does not cache it)", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: { code: 1006, message: "No matching location found." } }, 400));
    const response = await call("zzzzzz");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["quota exceeded", 403, { error: { code: 2007, message: "API key has exceeded calls per month quota." } }],
    ["invalid key", 401, { error: { code: 2006, message: "API key provided is invalid" } }],
    ["provider outage", 500, { error: { code: 9999, message: "Internal application error." } }],
    ["a non-JSON error page", 502, "<html>Bad gateway</html>"],
  ])("treats %s as unavailable and does not pass its message on", async (_label, status, body) => {
    fetchMock.mockResolvedValueOnce(reply(body, status));
    const response = await call("Lubbock");
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toMatch(/quota|invalid|Internal|Bad gateway/i);
  });

  it("treats a network failure or timeout as unavailable and keeps the key out of the logs", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error(`fetch failed: https://api.weatherapi.com/v1/current.json?key=${KEY}`), { name: "TimeoutError" }));
    const response = await call("Lubbock");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(KEY);
  });

  it("keeps the key out of the logs for every failure path", async () => {
    vi.stubEnv("WEATHERAPI_KEY", "");
    await call("Lubbock");
    vi.stubEnv("WEATHERAPI_KEY", KEY);
    fetchMock.mockResolvedValueOnce(reply({ error: { code: 2007, message: `bad ${KEY}` } }, 403));
    await call("Lubbock");
    fetchMock.mockResolvedValueOnce(reply({ nonsense: true }));
    await call("Lubbock");
    expect(errorLog).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(KEY);
  });

  it.each([
    ["no humidity", { current: { humidity: undefined } }],
    ["humidity over 100", { current: { humidity: 140 } }],
    ["temperature as text", { current: { temp_f: "71" } }],
    ["no condition", { current: { condition: undefined } }],
    ["no place name", { location: { name: "", region: "", country: "" } }],
  ])("treats a reply with %s as unavailable rather than showing partial data", async (_label, overrides) => {
    fetchMock.mockResolvedValueOnce(reply(upstreamBody(overrides)));
    const response = await call("Lubbock");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
