import { useCallback, useRef, useState } from "react";
import {
  WeatherCache,
  fetchWeather,
  normalizePlaceQuery,
  positionQuery,
  type WeatherResult,
} from "../weather/client";
import { getCurrentPosition } from "../weather/geolocation";
import type { WeatherErrorCode, WeatherReport } from "../weather/types";

export type WeatherProblem = WeatherErrorCode | "location_denied" | "location_unsupported" | "location_failed";

export type WeatherState =
  | { status: "idle" }
  | { status: "loading"; source: "place" | "position" }
  | { status: "ready"; report: WeatherReport }
  | { status: "error"; problem: WeatherProblem };

/**
 * Current weather for the Pacer screen. Held in <App> so it survives switching screens.
 * Weather is strictly optional: nothing else in the app reads this, and every failure ends up as
 * a message in the weather card, never an exception.
 */
export function useWeather() {
  const [state, setState] = useState<WeatherState>({ status: "idle" });
  const cache = useRef(new WeatherCache());
  const lastQuery = useRef<{ query: string; source: "place" | "position" } | null>(null);
  // Only the newest request may update the screen (a slow earlier answer must not overwrite a newer one).
  const latest = useRef(0);

  const run = useCallback(async (query: string, source: "place" | "position", useCache: boolean) => {
    const id = ++latest.current;
    lastQuery.current = { query, source };
    const cached = useCache ? cache.current.get(query, Date.now()) : null;
    if (cached) {
      setState({ status: "ready", report: cached });
      return;
    }
    setState({ status: "loading", source });
    const result: WeatherResult = await fetchWeather(query);
    if (id !== latest.current) return;
    if (result.ok) {
      cache.current.set(query, result.report, Date.now());
      setState({ status: "ready", report: result.report });
    } else {
      setState({ status: "error", problem: result.error });
    }
  }, []);

  /** Look up a typed place (city, ZIP or postal code). */
  const lookupPlace = useCallback(
    (text: string) => {
      const query = normalizePlaceQuery(text);
      if (query === null) {
        latest.current++;
        setState({ status: "error", problem: "bad_query" });
        return Promise.resolve();
      }
      return run(query, "place", true);
    },
    [run],
  );

  /** Ask the browser for the position (it will prompt), then look up the weather there. */
  const lookupMyLocation = useCallback(async () => {
    const id = ++latest.current;
    setState({ status: "loading", source: "position" });
    const position = await getCurrentPosition();
    if (id !== latest.current) return;
    if (!position.ok) {
      setState({ status: "error", problem: position.error });
      return;
    }
    await run(positionQuery(position.latitude, position.longitude), "position", true);
  }, [run]);

  /**
   * Try the browser's location once, automatically, the first time the weather card appears.
   * "Once" is kept here (in <App>), not in the card, so leaving and returning to Pacer Mode never asks again.
   * If it fails the card shows its message and the typed-place form, so the coach can carry on.
   */
  const autoTried = useRef(false);
  const autoLocate = useCallback(() => {
    if (autoTried.current) return Promise.resolve();
    autoTried.current = true;
    return lookupMyLocation();
  }, [lookupMyLocation]);

  /** Fetch the last place again, skipping the cache. */
  const refresh = useCallback(() => {
    const last = lastQuery.current;
    if (last === null) return Promise.resolve();
    return run(last.query, last.source, false);
  }, [run]);

  return { state, lookupPlace, lookupMyLocation, autoLocate, refresh };
}

export type WeatherStore = ReturnType<typeof useWeather>;
