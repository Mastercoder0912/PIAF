import { useState } from "react";
import { CalculatorScreen } from "./screens/CalculatorScreen";
import type { Clock } from "./live/stopwatch";
import { PacerModeScreen, type PacerView } from "./screens/PacerModeScreen";
import { useCalculator } from "./state/useCalculator";
import { useLiveSession } from "./state/useLiveSession";
import { useWeather } from "./state/useWeather";
import { WeatherCard } from "./components/WeatherCard";
import { useLocations } from "./state/useLocations";
import { sessionPhase } from "./live/session";

type Screen = "calculator" | "pacer";

/** `clock` is only for tests; the app uses the browser's monotonic clock. */
export default function App({ clock }: { clock?: Clock } = {}) {
  const [screen, setScreen] = useState<Screen>("calculator");
  const [pacerView, setPacerView] = useState<PacerView>("setup");

  // Both live here (not inside a screen) so inputs, results and locations survive switching screens.
  // Pacing locations are kept separate from the calculator's split results.
  const locations = useLocations();
  const calc = useCalculator({
    // Reset clears the locations too, so it asks first when there are any.
    hasExtraData: locations.count > 0,
    onReset: locations.clear,
  });
  const race = calc.result?.calculation ?? null;
  // The live session (stopwatch and recorded times) is separate from both of the above.
  const live = useLiveSession(clock);
  // Weather is optional and independent of everything above: nothing else reads it.
  const weather = useWeather();
  const liveActive = sessionPhase(live.state) !== "idle";

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          Running <span className="brand-accent">Pacer</span>
        </div>
        <nav aria-label="Primary" className="nav">
          <button
            type="button"
            className="nav-btn"
            aria-current={screen === "calculator" ? "page" : undefined}
            onClick={() => setScreen("calculator")}
          >
            Calculator
          </button>
          <button
            type="button"
            className="nav-btn"
            aria-current={screen === "pacer" ? "page" : undefined}
            onClick={() => setScreen("pacer")}
          >
            Pacer Mode
            {liveActive ? (
              <>
                <span className="nav-live" aria-hidden="true" />
                {" "}
                <span className="sr-only">(live session in progress)</span>
              </>
            ) : null}
          </button>
        </nav>
      </header>

      <main className="container">
        {screen === "calculator" ? (
          <CalculatorScreen calc={calc} pacingLocationCount={locations.count} />
        ) : (
          <PacerModeScreen
            race={race}
            isStale={calc.isStale}
            locations={locations}
            live={live}
            view={pacerView}
            onViewChange={setPacerView}
            onOpenCalculator={() => setScreen("calculator")}
            weatherSlot={<WeatherCard weather={weather} />}
          />
        )}
      </main>
    </div>
  );
}
