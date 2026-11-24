// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWeather } from "../../src/state/useWeather";
import type { WeatherReport } from "../../src/weather/types";
import "./setup";

const report = (place: string): WeatherReport => ({
  place,
  tempF: 71,
  tempC: 21.7,
  feelsLikeF: 70,
  feelsLikeC: 21,
  condition: "Clear",
  windMph: 5,
  windKph: 8,
  windDir: "N",
  humidity: 40,
  observedAt: "2026-11-23 15:15",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** A fetch answer the test releases by hand, to control the order in which replies arrive. */
function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useWeather: only the newest request may update the screen", () => {
  it("ignores a slow earlier reply that arrives after a newer one", async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useWeather());

    let one: Promise<void> = Promise.resolve();
    let two: Promise<void> = Promise.resolve();
    act(() => {
      one = result.current.lookupPlace("Lubbock");
      two = result.current.lookupPlace("Austin");
    });
    await act(async () => {
      second.resolve(json(report("Austin, Texas")));
      await two;
    });
    expect(result.current.state).toEqual({ status: "ready", report: report("Austin, Texas") });

    await act(async () => {
      first.resolve(json(report("Lubbock, Texas"))); // arrives late
      await one;
    });
    expect(result.current.state).toEqual({ status: "ready", report: report("Austin, Texas") });
  });

  it("ignores a late failure from an earlier request too", async () => {
    const first = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(json(report("Austin, Texas")));
    const { result } = renderHook(() => useWeather());

    let one: Promise<void> = Promise.resolve();
    await act(async () => {
      one = result.current.lookupPlace("Lubbock");
      await result.current.lookupPlace("Austin");
    });
    await act(async () => {
      first.resolve(json({ error: "unavailable" }, 502));
      await one;
    });
    expect(result.current.state).toMatchObject({ status: "ready" });
  });

  it("a typed place replaces an in-flight position lookup", async () => {
    const getPosition = vi.fn(); // never answers
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: getPosition }, configurable: true });
    fetchMock.mockResolvedValueOnce(json(report("Austin, Texas")));
    const { result } = renderHook(() => useWeather());
    act(() => void result.current.lookupMyLocation());
    expect(result.current.state).toEqual({ status: "loading", source: "position" });
    await act(async () => {
      await result.current.lookupPlace("Austin");
    });
    expect(result.current.state).toMatchObject({ status: "ready" });
    Reflect.deleteProperty(navigator, "geolocation");
  });
});

describe("useWeather: refresh", () => {
  it("does nothing before any lookup", async () => {
    const { result } = renderHook(() => useWeather());
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "idle" });
  });
});

describe("useWeather: automatic location", () => {
  afterEach(() => Reflect.deleteProperty(navigator, "geolocation"));

  it("autoLocate asks the browser for the position only the first time it is called", async () => {
    const getPosition = vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError));
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: getPosition }, configurable: true });
    const { result } = renderHook(() => useWeather());
    await act(async () => {
      await result.current.autoLocate();
    });
    expect(result.current.state).toEqual({ status: "error", problem: "location_denied" });
    await act(async () => {
      await result.current.autoLocate();
      await result.current.autoLocate();
    });
    expect(getPosition).toHaveBeenCalledTimes(1);
    // The explicit button path is separate and always tries.
    await act(async () => {
      await result.current.lookupMyLocation();
    });
    expect(getPosition).toHaveBeenCalledTimes(2);
  });
});
