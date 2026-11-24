import { useEffect, useState, type FormEvent } from "react";
import type { WeatherProblem, WeatherStore } from "../state/useWeather";
import { formatHumidity, formatObservedTime, formatTemperature, formatWind } from "../weather/format";

const PROBLEM_TEXT: Record<WeatherProblem, string> = {
  bad_query: "Enter a city or a ZIP code, for example “Lubbock, TX” or “79401”.",
  not_found: "We couldn't find that place. Try a city and state, or a ZIP code.",
  unavailable: "Weather isn't available right now. Everything else in the app still works.",
  location_denied: "Location sharing wasn't allowed. You can type a city or ZIP code instead.",
  location_unsupported: "This browser can't share your location. Type a city or ZIP code instead.",
  location_failed: "Couldn't get your location. Type a city or ZIP code instead.",
};

/**
 * Compact current weather. Optional by design: the form only asks for a place when the coach wants
 * weather, location sharing is a separate button, and any failure shows a short message in this card only.
 */
export function WeatherCard({ weather }: { weather: WeatherStore }) {
  const { state } = weather;
  const [place, setPlace] = useState("");
  // After a successful lookup the form tucks away; "Change" brings it back.
  const [changing, setChanging] = useState(false);

  // Try the current location as soon as the card appears (once per visit to the app; see useWeather).
  const { autoLocate } = weather;
  useEffect(() => {
    void autoLocate();
  }, [autoLocate]);

  const loading = state.status === "loading";
  // While the location is being found the coach may already type a place instead, so only a place lookup locks the button.
  const lookingUpPlace = state.status === "loading" && state.source === "place";
  const showForm = state.status !== "ready" || changing;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setChanging(false);
    void weather.lookupPlace(place);
  }

  function handleMyLocation() {
    setChanging(false);
    void weather.lookupMyLocation();
  }

  const report = state.status === "ready" ? state.report : null;
  const observed = report ? formatObservedTime(report.observedAt) : null;

  return (
    <section className="card weather-card" aria-labelledby="weather-heading">
      <div className="weather-head">
        <h2 id="weather-heading" className="group-title">
          Weather
        </h2>
        {report ? (
          <div className="weather-tools">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void weather.refresh()}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              aria-expanded={changing}
              onClick={() => setChanging((open) => !open)}
            >
              Change place
            </button>
          </div>
        ) : null}
      </div>

      {showForm ? (
        <form className="weather-form" onSubmit={handleSubmit} aria-label="Find weather">
          <div className="field">
            <label htmlFor="weather-place" className="label">
              City or ZIP code
            </label>
            <div className="weather-row">
              <input
                id="weather-place"
                className="input"
                type="text"
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="Lubbock, TX"
                value={place}
                onChange={(event) => setPlace(event.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={lookingUpPlace}>
                Get weather
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleMyLocation} disabled={loading}>
            Use my location
          </button>
          <p className="hint">
            We try your current location first. It is only used to look up the weather and isn't stored.
          </p>
        </form>
      ) : null}

      <div className="weather-status" role="status" aria-live="polite">
        {loading ? (
          <p className="weather-message">{state.source === "position" ? "Finding the weather near you…" : "Getting the weather…"}</p>
        ) : null}
        {state.status === "error" ? <p className="weather-message weather-error">{PROBLEM_TEXT[state.problem]}</p> : null}
      </div>

      {report ? (
        <div className="weather-report">
          <p className="weather-place">
            {report.place}
            {observed ? <span className="weather-time">{` · updated ${observed}`}</span> : null}
          </p>
          <dl className="weather-grid">
            <div className="weather-primary">
              <dt>Temperature</dt>
              <dd>{formatTemperature(report.tempF, report.tempC)}</dd>
            </div>
            <div>
              <dt>Feels like</dt>
              <dd>{formatTemperature(report.feelsLikeF, report.feelsLikeC)}</dd>
            </div>
            <div>
              <dt>Conditions</dt>
              <dd>{report.condition}</dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>{formatHumidity(report.humidity)}</dd>
            </div>
            <div className="weather-wind">
              <dt>Wind</dt>
              <dd>{formatWind(report)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <p className="weather-credit">
        Powered by{" "}
        <a href="https://www.weatherapi.com/" target="_blank" rel="noopener noreferrer" title="Free Weather API">
          WeatherAPI.com
        </a>
        . General conditions for the area, not measured at the course. They can change quickly and may differ from
        what runners feel.
      </p>
    </section>
  );
}
