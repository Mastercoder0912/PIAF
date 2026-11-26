import { useState } from "react";
import { CourseMap } from "../components/CourseMap";
import { ElevationProfile } from "../components/ElevationProfile";
import { AdjustedPaceCard } from "../components/AdjustedPaceCard";
import { COURSES } from "../courses";
import {
  describeGap,
  formatClimb,
  formatDistance,
  formatElevation,
  formatMiles,
  formatRecordedDate,
  metersToFeet,
} from "../courses/format";
import { clampDistance, positionAt } from "../courses/position";
import { elevationColor } from "../courses/route";
import type { CourseData } from "../courses/types";
import type { RaceCalculation } from "../engine";

/** One step of the slider, in meters. Fine enough to feel continuous; coarse enough for the arrow keys to be useful. */
const SLIDER_STEP_METERS = 5;

interface CourseExplorerScreenProps {
  /** The courses to offer. Defaults to the ones that ship with the app; tests pass their own. */
  courses?: readonly CourseData[];
  /** The calculator's last calculated race, used for the estimate. Read only. */
  race?: RaceCalculation | null;
  raceIsStale?: boolean;
  onOpenCalculator?: () => void;
}

/**
 * Explore a Course: the map, the elevation profile and a slider, all driven by ONE number (the distance along
 * the course). The map marker, the profile cursor, the slider and the readouts are all computed from it,
 * so they cannot disagree.
 */
export function CourseExplorerScreen({ courses = COURSES, race = null, raceIsStale = false, onOpenCalculator }: CourseExplorerScreenProps) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [meters, setMeters] = useState(0);

  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  if (!course) {
    return (
      <section className="card" aria-labelledby="course-empty-heading">
        <h2 id="course-empty-heading" className="group-title">
          Explore a Course
        </h2>
        <p>No courses are available yet.</p>
      </section>
    );
  }

  const position = positionAt(course, meters);
  const sliderMax = Math.ceil(course.distanceMeters / SLIDER_STEP_METERS) * SLIDER_STEP_METERS;
  const sliderValue = Math.min(sliderMax, Math.round(position.distanceMeters / SLIDER_STEP_METERS) * SLIDER_STEP_METERS);
  const moveTo = (distance: number) => setMeters(clampDistance(course, distance));

  const recorded = formatRecordedDate(course.source.recordedAt);

  return (
    <div className="stack course-explorer">
      <section className="card course-intro" aria-labelledby="course-heading">
        <p className="course-kicker">Explore a Course</p>
        {courses.length > 1 ? (
          <div className="field">
            <label htmlFor="course-select" className="label">
              Course
            </label>
            <select
              id="course-select"
              className="input"
              value={course.id}
              onChange={(event) => {
                setCourseId(event.target.value);
                setMeters(0);
              }}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <h2 id="course-heading" className="course-title">
          {course.name}
        </h2>
        <p className="course-place">{course.place}</p>
        <p>{course.summary}</p>
      </section>

      <section className="card course-map-card" aria-label={`${course.name} map`}>
        <CourseMap course={course} position={position} />
        <div className="course-legend">
          <div className="legend-scale">
            <span>
              Lowest <strong>{formatElevation(course.elevation.minMeters)}</strong>
            </span>
            <span>
              Highest <strong>{formatElevation(course.elevation.maxMeters)}</strong>
            </span>
          </div>
          <div
            className="legend-gradient"
            data-testid="legend-gradient"
            role="img"
            aria-label="Route color: red at the lowest point, through yellow, to green at the highest point"
            style={{ background: `linear-gradient(90deg, ${elevationColor(0)}, ${elevationColor(0.5)}, ${elevationColor(1)})` }}
          />
          {course.gaps.length > 0 ? (
            <p className="legend-gap">
              <span className="legend-dash" aria-hidden="true" /> Dashed: nothing was recorded here
            </p>
          ) : null}
        </div>
      </section>

      <section className="card course-profile-card" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="group-title">
          Elevation profile
        </h2>

        <dl className="course-readout" data-testid="course-readout">
          <div>
            <dt>Distance</dt>
            <dd data-testid="readout-distance">
              <span className="readout-main">{formatMiles(position.distanceMeters)}</span>{" "}
              <span className="readout-sub">{(position.distanceMeters / 1000).toFixed(2)} km</span>
            </dd>
          </div>
          <div>
            <dt>Elevation</dt>
            <dd data-testid="readout-elevation">
              <span className="readout-main">{Math.round(metersToFeet(position.elevationMeters))} ft</span>{" "}
              <span className="readout-sub">{position.elevationMeters.toFixed(1)} m</span>
            </dd>
          </div>
        </dl>
        <p className="course-estimate" aria-live="polite">
          {position.inGap ? "Nothing was recorded at this spot, so the position and elevation are estimates." : ""}
        </p>

        <ElevationProfile course={course} position={position} onScrub={moveTo} />
        <p className="profile-caption">Feet above sea level, by miles from the start</p>

        <div className="field course-slider">
          <label htmlFor="course-position" className="label">
            Position along the course
          </label>
          <input
            id="course-position"
            className="slider"
            type="range"
            min={0}
            max={sliderMax}
            step={SLIDER_STEP_METERS}
            value={sliderValue}
            aria-valuetext={`${formatDistance(position.distanceMeters)}, elevation ${formatElevation(position.elevationMeters)}`}
            onChange={(event) => moveTo(Number(event.target.value))}
          />
          <p className="hint">Drag the slider, or touch the chart. The marker on the map follows.</p>
        </div>
      </section>

      <AdjustedPaceCard course={course} race={race} raceIsStale={raceIsStale} onOpenCalculator={onOpenCalculator} />

      <section className="card course-facts-card" aria-labelledby="facts-heading">
        <h2 id="facts-heading" className="group-title">
          About this route
        </h2>
        <dl className="course-facts">
          <div>
            <dt>Total distance</dt>
            <dd>{formatDistance(course.distanceMeters)}</dd>
          </div>
          <div>
            <dt>Elevation gain</dt>
            <dd>{formatClimb(course.elevation.gainMeters)}</dd>
          </div>
          <div>
            <dt>Elevation loss</dt>
            <dd>{formatClimb(course.elevation.lossMeters)}</dd>
          </div>
          <div>
            <dt>Highest point</dt>
            <dd>{formatElevation(course.elevation.maxMeters)}</dd>
          </div>
          <div>
            <dt>Lowest point</dt>
            <dd>{formatElevation(course.elevation.minMeters)}</dd>
          </div>
        </dl>

        <ul className="course-notes">
          {course.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
          {course.gaps.map((gap) => (
            <li key={`${gap.startMeters}-${gap.endMeters}`}>{describeGap(gap)}</li>
          ))}
          <li>Gain and loss: {course.elevation.method}</li>
          <li>
            Source: {course.source.kind === "garmin-gpx" ? "Garmin" : "GPX"} recording
            {recorded ? ` from ${recorded}` : ""}, {course.source.pointCount} recorded points.
          </li>
        </ul>
      </section>
    </div>
  );
}
