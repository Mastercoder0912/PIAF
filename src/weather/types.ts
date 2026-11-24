/**
 * The weather shape shared by the server function (api/weather.ts) and the app.
 * It is deliberately small: only what the Pacer screen shows.
 */
export interface WeatherReport {
  /** "Lubbock, Texas" */
  place: string;
  tempF: number;
  tempC: number;
  feelsLikeF: number;
  feelsLikeC: number;
  /** "Partly cloudy" */
  condition: string;
  windMph: number;
  windKph: number;
  /** 16-point compass abbreviation: "N", "NNE", "SW"… */
  windDir: string;
  /** Percent, 0 to 100 */
  humidity: number;
  /** When the provider last updated this reading, as local time at the place: "2026-11-23 15:15" */
  observedAt: string;
}

/**
 * Why a lookup failed. Plain categories only: the provider's raw messages are never sent to the app,
 * because they can mention account details.
 */
export type WeatherErrorCode = "bad_query" | "not_found" | "unavailable";

export type WeatherErrorBody = { error: WeatherErrorCode };
