import { projectRace } from "../adjust/project";
import { COURSE_MATCH_TOLERANCE } from "../adjust/project";
import { describeDifference, formatPacePerMile } from "../adjust/format";
import { formatMiles } from "../courses/format";
import type { CourseData } from "../courses/types";
import { formatDistanceLabel, formatDuration, type RaceCalculation } from "../engine";
import { formatTenths } from "../display";

interface AdjustedPaceCardProps {
  course: CourseData;
  /** The last calculated race from the calculator, or null if there isn't one. */
  race: RaceCalculation | null;
  /** True when the calculator's inputs have changed since `race` was calculated. */
  raceIsStale?: boolean;
  onOpenCalculator?: () => void;
}

/**
 * Elevation-adjusted pace for the race the coach already calculated. It only reads that race: the target pace
 * and splits in the calculator are never changed, and the original target stays on screen next to the estimate.
 */
export function AdjustedPaceCard({ course, race, raceIsStale = false, onOpenCalculator }: AdjustedPaceCardProps) {
  const projection = race ? projectRace(race, course) : null;

  return (
    <section className="card estimate-card" aria-labelledby="estimate-heading">
      <h2 id="estimate-heading" className="group-title" tabIndex={-1}>
        Estimated pace on this course <span className="estimate-pill">Estimate</span>
      </h2>

      {!race || !projection ? (
        <>
          <p>Calculate a race first, then come back to see roughly how this course could change your splits.</p>
          {onOpenCalculator ? (
            <button type="button" className="btn btn-secondary" onClick={onOpenCalculator}>
              Go to the calculator
            </button>
          ) : null}
        </>
      ) : projection.kind === "distance_mismatch" ? (
        <p data-testid="estimate-mismatch">
          This course is {formatMiles(projection.courseMeters)} long and your race is {formatMiles(projection.raceMeters)}, so no
          estimate is shown. It only works for a race about as long as the course (within{" "}
          {Math.round(COURSE_MATCH_TOLERANCE * 100)}%).
        </p>
      ) : (
        <>
          <p className="estimate-lead">
            If the runner gives the same effort as at the target pace on flat ground, this is roughly what to expect here. It is an
            estimate, not a prediction.
          </p>
          {raceIsStale ? (
            <p className="estimate-note" role="status">
              You changed the race after calculating it. This uses the last calculated race.
            </p>
          ) : null}

          <dl className="course-facts estimate-compare">
            <div>
              <dt>Your target pace</dt>
              <dd data-testid="original-pace">{formatPacePerMile(projection.originalPaceSecondsPerMile)}</dd>
              <dd className="readout-sub">Finish {formatTenths(projection.originalSeconds)}</dd>
            </div>
            <div>
              <dt>Estimated pace here</dt>
              <dd data-testid="estimated-pace">{formatPacePerMile(projection.estimatedPaceSecondsPerMile)}</dd>
              <dd className="readout-sub">Finish about {formatDuration(projection.estimatedSeconds, 0)}</dd>
            </div>
          </dl>
          <p className="estimate-difference" data-testid="estimate-difference">
            {describeDifference(projection.differenceSeconds, projection.originalSeconds)}
          </p>

          <h3 className="estimate-subtitle">Estimated splits</h3>
          <div className="table-wrap">
            <table className="splits estimate-table">
              <caption className="sr-only">Estimated passing time at each split on this course, next to the flat target</caption>
              <thead>
                <tr>
                  <th scope="col">Distance</th>
                  <th scope="col" className="col-time">
                    Flat target
                  </th>
                  <th scope="col" className="col-time">
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody>
                {projection.rows.map((row) => (
                  <tr key={row.id} className={row.isFinish ? "finish-row" : undefined}>
                    <th scope="row" className="col-distance">
                      <span className="distance-text">{row.isFinish ? formatDistanceLabel(row.distanceMeters) : row.label}</span>
                      {row.isFinish ? <span className="finish-pill">Finish</span> : null}
                    </th>
                    <td className="col-time">{formatTenths(row.originalSeconds)}</td>
                    <td className="col-time">
                      <span className="estimate-time">≈ {formatDuration(row.estimatedSeconds, 0)}</span>
                      <span className="estimate-leg">{formatPacePerMile(row.legPaceSecondsPerMile)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Under each estimate: the pace for just that stretch.</p>

          <details className="estimate-details">
            <summary>How this estimate works, and what it can't know</summary>
            <ul className="course-notes">
              <li>
                Uphill costs more time than downhill gives back. The rule of thumb used: about 3.4% slower for each 1% of uphill grade,
                and up to 12% faster on a gentle descent (best around 9%), with no gain on very steep descents.
              </li>
              <li>The slope is measured over stretches of about 100 m along the recorded route, so tiny bumps in the data don't count.</li>
              <li>
                Your {formatMiles(projection.raceMeters)} race is matched to this {formatMiles(projection.courseMeters)} route in
                proportion.
              </li>
              {projection.unrecordedShare > 0 ? (
                <li>
                  About {Math.max(1, Math.round(projection.unrecordedShare * 100))}% of the route, around the stretch where nothing was
                  recorded, is treated as flat because its elevation is unknown.
                </li>
              ) : null}
              <li>
                It does not know about the running surface, turns, wind or heat, how fit or hill-experienced this runner is, or how
                tired they are late in the race. Elevation readings from a watch can also be off by a few feet. Use it as a guide for
                planning, not a promise.
              </li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
