# Running Pacer

Race-split calculator, pacing-location planner and live race stopwatch for distance-running coaches. Phase 4: Live Pacer (stopwatch, manual passing-time recording, ahead/behind) on top of Phase 3 pacing locations, the Phase 2 calculator and the Phase 1 engine. V2 Phase 1 adds an elevation-colored Course Explorer (see [Explore a Course](#explore-a-course-v2-gpx-based)). Prototype additions: an optional weather card on Pacer Mode (see [Weather](#weather-optional)) and deployment to Vercel (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Run it

Requires **Node.js 22.22.2 or newer**. Supported lines: 22.x from 22.22.2, 24.x from 24.15.0, and 26+. Node 20, older 22.x, and odd-numbered releases (23.x, 25.x) are outside the locked dependencies' declared ranges. The strictest are `jsdom` (`^22.22.2 || ^24.15.0 || >=26.0.0`) and `undici` (`>=22.19.0`), both used by the test suite. Verified on Node 22.23.5.

```bash
npm install
npm run dev        # http://localhost:5173  (add -- --host to open it on your phone over Wi-Fi)
```

Other commands:

```bash
npm test           # all tests (engine, calculator, pacing locations, live pacer)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run courses    # rebuild src/courses/data/*.json from the GPX files in courses/
npm run preview    # serve the production build at http://localhost:4173
```

The production build is plain static files (relative paths), so `dist/` works from any folder or web host.
The calculator, pacing locations and Live Pacer run entirely in the browser: nothing is stored, so refreshing the page clears the race and the locations. The only network call is the optional weather lookup (below), which goes to this app's own `/api/weather` function.

## Structure

```
src/
  engine/        Phase 1 calculation engine + locations.ts (Phase 3 helper). Unchanged in Phase 4.
  live/          Phase 4 logic, plain TypeScript with no React (all testable on its own)
    stopwatch.ts   stopwatch state machine driven by clock readings
    session.ts     live session: frozen snapshot, recording, finish, edit-lock rules, change detection
    comparison.ts  ahead / behind / on-target
    format.ts      stopwatch and hundredths formatting
  state/
    form.ts, calculate.ts, parse.ts, useCalculator.ts   calculator form/glue (Phase 2)
    locations.ts, useLocations.ts                       pacing locations (Phase 3)
    useLiveSession.ts   thin React hook around the live session (reads the clock on each press)
  components/    DistanceInput, TargetInput, IntervalSelector, SplitTable, LocationForm, LocationList,
                 StopwatchDisplay, ...
  screens/       CalculatorScreen, PacerModeScreen (Locations / Live Pacer switch), LivePacerView
  display.ts     display-only rounding and distance formatting
  adjust/        elevation-adjusted estimates: model.ts (grade rule), project.ts (one course), compare.ts (course to course)
  courses/       V2 Course Explorer logic (GPX parser, distance/elevation, position, profile, route colors) + data/<id>.json
  weather/       client (fetch, checks, 10-minute cache), geolocation helper, display formatting, shared types
  App.tsx, main.tsx, styles.css
courses/         original GPX files and course.json per course; scripts/build-courses.ts makes the app data
api/
  weather.ts     serverless weather proxy (the only place the WeatherAPI.com key is read)
public/          home-screen icons and manifest
vercel.json, DEPLOYMENT.md, .env.example
tests/
  *.test.ts                    engine tests (Phase 1, Phase 3 helper)
  live/*.test.ts               stopwatch, session, comparison and formatting tests (Phase 4)
  ui/state.test.ts, ui/locations-state.test.ts   calculator and location logic
  ui/app.test.tsx, ui/pacer.test.tsx, ui/live.test.tsx   full-UI tests (jsdom + Testing Library)
  weather/*.test.ts, ui/weather.test.tsx, ui/useWeather.test.tsx   weather proxy, client and card
  secrets.test.ts              guards that the API key can't reach the browser bundle
```

## Explore a Course (V2, GPX-based)

Switch to **Explore a Course** with the buttons under the title. It is separate from Race Pacer: it shares no state with the calculator, locations, Live Pacer or weather, and a running live session keeps going (a banner links back to it).

- **Map** of the real GPX route, colored by elevation: the lowest point is red, the highest is green, with a gradient between (24 shades, hue 0° to 120°). A legend under the map shows the scale. A dashed amber line marks any stretch where the watch recorded nothing.
- **Elevation profile** below the map, in feet by miles, with the total distance, gain and loss in the facts card.
- **Slider and touch.** One position drives everything: the slider, the map marker, the profile cursor and the distance/elevation readout. Drag the slider, use arrow keys, or touch/drag the chart.
- **Course data.** The original GPX file is kept untouched in `courses/<id>/`; `npm run courses` generates `src/courses/data/<id>.json` from it (a test fails if the committed JSON drifts from the GPX). See [courses/README.md](courses/README.md) for adding a course.
- **Map provider.** Leaflet with OpenStreetMap tiles (`tile.openstreetmap.org`, no key). Attribution is shown on the map and is required. OSM's tile servers are a free community resource with a [usage policy](https://operations.osmfoundation.org/policies/tiles/) (no heavy or bulk use, a valid referrer, no scraping): fine for a coaching prototype, not for large traffic. To change provider, edit the tile URL and attribution in `src/components/CourseMap.tsx`. The route is vector lines, so it still shows if tiles fail to load.
- **Accuracy.** Distance uses the WGS-84 ellipsoid. Gain and loss are estimates (5-point moving average of the watch's elevation). John Hunt Park is one recorded training run, not a measured race course.
- **Estimated pace on this course.** If you have calculated a race in Race Pacer, a card shows your flat target pace next to an estimate for this course, plus estimated splits, labelled as an estimate. It only reads the calculated race (the engine is untouched) and only appears for a race within 3% of the course length. The rule (`src/adjust/model.ts`): about 3.4% slower per 1% of uphill grade; downhill up to 12% faster at -9%, fading to no gain at -18%. Grades are measured over about 100 m; the stretch with no recorded elevation counts as flat and is reported. It is a rule of thumb, not a measurement.
- Not included: predictions, searching for courses.

## Compare Courses (V2)

Enter times you ran on an **old course** and see roughly what the same effort would look like on a **new course**. For each stretch (every whole mile, then the finish) the old course's hill effect is taken out of the time and the new course's is put in: `new time = old time x new factor / old factor`, using the same rule as above, so your own pattern (a fade, a kick) carries over and only the hills change. Both courses must be within 3% of the race distance. The two elevation profiles are shown on one scale (same miles across, same feet up). It is an estimate and changes nothing in Race Pacer.

To compare against a course, it has to be loaded first: add a GPX file of a run on it (see [courses/README.md](courses/README.md)). A course name alone carries no elevation.

## Pacing locations (Phase 3)

- A location is stored as only **id, name, distance (meters) and the unit it was typed in**. It does not store a time.
- Target time = the race's pace x the location's distance, computed by the engine each time it is shown from the last
  calculated race. Each location is computed straight from the pace (never from another location), with no rounding
  until display, so nothing accumulates or goes stale. Recalculate the race and every time updates.
- The **Finish** is automatic and locked: it always shows the race's exact total time and can't be edited or deleted.
- Automatic splits follow one rule per race distance (exact statute mile, 1609.344 m): under a mile, every 200 m;
  exactly one mile, every 400 m (400, 800, 1200, Finish); longer than a mile, whole-mile markers only. The finish is
  always included, never duplicated. The rules live in `src/engine/splits.ts`.
- Locations are independent of the split table and interval. "Import splits" copies the splits as ordinary locations,
  skipping distances that already have one, so importing twice adds nothing and your own locations are kept.
- If a new race is shorter than a location, the location is kept under "Needs attention" with no time, so you can fix or delete it.
- Reset in the calculator also clears the locations (it asks first, and says so).
- Ids (`loc-1`, `loc-2`, ...) are never reused, even after a delete or Reset.

## Weather (optional)

A compact card under the active race on Pacer Mode (Locations view): temperature, feels-like, conditions, wind and humidity.

- **Location first, typed place as the fallback.** When Pacer Mode opens, the card tries the browser's current location once
  (the browser asks permission). If that is refused, unavailable or times out, the card says so and shows a "City or ZIP code"
  box. *Use my location* retries, and Pacer Mode never asks again on its own during the same visit. The calculator screen never
  asks. Any failure shows a short message in the card only, and the calculator never depends on weather.
- **The key stays on the server.** The app calls `/api/weather?q=…`; `api/weather.ts` reads `WEATHERAPI_KEY` from the host's
  server-side environment, calls WeatherAPI.com and returns a small, validated report. The key is never in the page,
  never in a response and never in a log. No `VITE_` variable is used. `tests/secrets.test.ts` guards this.
- **Caching.** Successful replies are cached for 10 minutes by the host's network (`s-maxage=600`) and in the browser;
  errors are never cached. *Refresh* skips the browser cache.
- Shown with a "Powered by WeatherAPI.com" link and a note that conditions are general for the area, not measured at the course.

## Live Pacer (Phase 4)

Pacer Mode has two views: **Locations** (set up where to watch) and **Live Pacer** (run the race).

- **Stopwatch accuracy.** Elapsed time is computed from `performance.now()` timestamps, never by counting ticks. The screen
  redraws on `requestAnimationFrame`, but each frame only *reads* the time, so a hidden, throttled or busy tab can't
  cause drift. The frame loop stops on pause and on unmount.
- **Record Passing Time** reads the clock inside the button's click handler, before any rendering, and stores the full-precision
  elapsed seconds against the location's stable id. Two presses within 0.5 s are treated as an accidental double tap.
- **Ahead / behind.** `difference = actual - target`. Negative is ahead, positive is behind, and within +/-1.00 s (inclusive) is on
  target. The status is always shown as text (AHEAD / ON TARGET / BEHIND) as well as color.
- **Session snapshot.** Starting the stopwatch freezes a copy of the race and locations. The session keeps those targets even
  if the calculator changes later, and shows a warning when the live setup no longer matches. Reset the session to pick up changes.
- **Locations are locked** while the stopwatch is running, and after any time has been recorded, until the session is reset.
  Paused with nothing recorded, editing is allowed.
- **Finish.** Recording the finish completes the session and freezes the stopwatch at that same instant.
- Nothing is saved: a refresh clears the session.

## Look

Light theme: page `#F8FAFC`, white cards with a `#E2E8F0` border, text `#0F172A`, labels `#475569`, actions `#2563EB` (white on it is 5.17:1). Meaning colors stay apart from the blue: green = ahead, red = behind, amber = notices. Inputs and outline buttons use a darker edge (`--border-strong`) so they meet the 3:1 contrast for controls. The theme is a set of variables at the top of `src/styles.css`.

## Rules the UI follows

- No pace or split math in React. Pace, time, splits and location times come only from the engine.
- Underlying values are never rounded; only the display shows tenths of a second.
- Everything is converted to meters (via the engine) before calculation.
