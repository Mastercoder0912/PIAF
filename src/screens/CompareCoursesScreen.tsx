import { useMemo, useState } from "react";
import { describeCourseChange, formatPacePerMile } from "../adjust/format";
import { legEnds, projectPerformance } from "../adjust/compare";
import { COURSE_MATCH_TOLERANCE, matchesCourse } from "../adjust/project";
import { DistanceInput } from "../components/DistanceInput";
import { StaticProfile } from "../components/StaticProfile";
import { TextField } from "../components/TextField";
import { COURSES } from "../courses";
import { formatMiles } from "../courses/format";
import { sharedElevationScale } from "../courses/profile";
import type { CourseData } from "../courses/types";
import { formatDistanceLabel, formatDuration, parseTimeString, type DistanceUnit } from "../engine";
import { formatTenths } from "../display";
import { distanceMetersOrNull } from "../state/parse";

/** Words for where a leg starts and ends, e.g. "Start to 1 mile", "3 miles to the finish". */
function legLabel(startMeters: number, endMeters: number, isFinish: boolean): string {
  const from = startMeters === 0 ? "Start" : formatDistanceLabel(startMeters);
  const to = isFinish ? "the finish" : formatDistanceLabel(endMeters);
  return `${from} to ${to}`;
}

/** Parse one leg time. Empty is "not entered yet" (no error); anything else must be a time above zero. */
function readLeg(text: string): { seconds: number | null; error: string | null } {
  if (text.trim() === "") return { seconds: null, error: null };
  const parsed = parseTimeString(text, "time");
  if (!parsed.ok) return { seconds: null, error: parsed.errors[0]?.message ?? "Enter a time like 5:53.4." };
  if (!(parsed.value > 0)) return { seconds: null, error: "A leg time must be greater than 0." };
  return { seconds: parsed.value, error: null };
}

/**
 * Compare Courses: take times run on an OLD course and show roughly what the same effort would look like on a
 * NEW course, based on the elevation of both. An estimate: nothing here changes the Race Pacer.
 */
export function CompareCoursesScreen({ courses = COURSES }: { courses?: readonly CourseData[] }) {
  const [oldId, setOldId] = useState(courses[0]!.id);
  const [newId, setNewId] = useState((courses[1] ?? courses[0]!).id);
  const [distanceText, setDistanceText] = useState("5");
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [legTexts, setLegTexts] = useState<Record<string, string>>({});

  const oldCourse = courses.find((c) => c.id === oldId) ?? courses[0]!;
  const newCourse = courses.find((c) => c.id === newId) ?? courses[0]!;
  const raceMeters = distanceMetersOrNull(distanceText, unit);

  const fits =
    raceMeters !== null && matchesCourse(raceMeters, oldCourse.distanceMeters) && matchesCourse(raceMeters, newCourse.distanceMeters);
  const ends = useMemo(() => (raceMeters !== null && fits ? legEnds(raceMeters) : []), [raceMeters, fits]);

  const legs = ends.map((_, i) => readLeg(legTexts[String(ends[i])] ?? ""));
  const allEntered = ends.length > 0 && legs.every((l) => l.seconds !== null);
  const enteredTotal = legs.reduce((sum, l) => sum + (l.seconds ?? 0), 0);
  const comparison =
    allEntered && raceMeters !== null
      ? projectPerformance(raceMeters, legs.map((l) => l.seconds as number), oldCourse, newCourse)
      : null;

  const mismatch =
    raceMeters === null
      ? null
      : !matchesCourse(raceMeters, oldCourse.distanceMeters)
        ? { course: oldCourse, role: "old" }
        : !matchesCourse(raceMeters, newCourse.distanceMeters)
          ? { course: newCourse, role: "new" }
          : null;

  const domain = Math.max(oldCourse.distanceMeters, newCourse.distanceMeters);
  const scale = useMemo(() => sharedElevationScale([oldCourse, newCourse]), [oldCourse, newCourse]);

  const courseSelect = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="field">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="stack compare-courses">
      <section className="card" aria-labelledby="compare-heading">
        <p className="course-kicker">Compare Courses</p>
        <h2 id="compare-heading" className="course-title">
          Same effort, different course
        </h2>
        <p>
          Enter the times you ran on an old course, and see roughly what the same effort would look like on another course, based on
          the hills of both. It is an estimate.
        </p>
        {courses.length < 2 ? (
          <p className="estimate-note" role="status">
            Only one course is loaded so far, so there is nothing to compare it with. Courses are added from a GPX file of a run on
            them.
          </p>
        ) : null}
        {courseSelect("old-course", "Old course (where these times were run)", oldCourse.id, setOldId)}
        {courseSelect("new-course", "New course (where you want to know)", newCourse.id, setNewId)}
        {oldCourse.id === newCourse.id && courses.length > 1 ? (
          <p className="hint">You picked the same course twice, so the times won't change.</p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="compare-times-heading">
        <h2 id="compare-times-heading" className="group-title">
          Your times
        </h2>
        <DistanceInput text={distanceText} unit={unit} onTextChange={setDistanceText} onUnitChange={setUnit} />

        {raceMeters === null ? (
          <p className="hint">Enter the race distance to continue.</p>
        ) : mismatch ? (
          <p data-testid="compare-mismatch">
            {mismatch.course.name} is {formatMiles(mismatch.course.distanceMeters)} long and your race is {formatMiles(raceMeters)}. This
            only works for a race about as long as both courses (within {Math.round(COURSE_MATCH_TOLERANCE * 100)}%).
          </p>
        ) : (
          <div className="group">
            <p className="hint">
              Type the time for each stretch on its own, not the running total. For example 5:53.4 for the first mile.
            </p>
            {ends.map((end, i) => (
              <TextField
                key={end}
                id={`leg-${i}`}
                label={legLabel(i === 0 ? 0 : ends[i - 1]!, end, i === ends.length - 1)}
                value={legTexts[String(ends[i])] ?? ""}
                onChange={(value) => setLegTexts((current) => ({ ...current, [String(end)]: value }))}
                errors={legs[i]!.error ? [legs[i]!.error as string] : undefined}
                placeholder="e.g. 6:10.3"
                inputMode="text"
              />
            ))}
            <p className="estimate-difference" data-testid="entered-total">
              {allEntered ? `Total: ${formatTenths(enteredTotal)}` : "Enter every time to see the estimate."}
            </p>
          </div>
        )}
      </section>

      {comparison && comparison.kind === "ok" ? (
        <section className="card estimate-card" aria-labelledby="compare-result-heading">
          <h2 id="compare-result-heading" className="group-title" tabIndex={-1}>
            On {newCourse.name} <span className="estimate-pill">Estimate</span>
          </h2>
          <dl className="course-facts estimate-compare">
            <div>
              <dt>{oldCourse.name}</dt>
              <dd data-testid="old-total">{formatTenths(comparison.oldSeconds)}</dd>
              <dd className="readout-sub">{formatPacePerMile(comparison.oldPaceSecondsPerMile)}</dd>
            </div>
            <div>
              <dt>{newCourse.name}</dt>
              <dd data-testid="new-total">about {formatDuration(comparison.newSeconds, 0)}</dd>
              <dd className="readout-sub">{formatPacePerMile(comparison.newPaceSecondsPerMile)}</dd>
            </div>
          </dl>
          <p className="estimate-difference" data-testid="compare-difference">
            {describeCourseChange(comparison.differenceSeconds, comparison.oldSeconds, oldCourse.name, newCourse.name)}
          </p>

          <h3 className="estimate-subtitle">Estimated times</h3>
          <div className="table-wrap">
            <table className="splits estimate-table">
              <caption className="sr-only">
                Your times on {oldCourse.name} and the estimated times for the same effort on {newCourse.name}, for each stretch
              </caption>
              <thead>
                <tr>
                  <th scope="col">Stretch</th>
                  <th scope="col" className="col-time">
                    Old course
                  </th>
                  <th scope="col" className="col-time">
                    New course
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row, i) => (
                  <tr key={row.endMeters} className={row.isFinish ? "finish-row" : undefined}>
                    <th scope="row" className="col-distance">
                      <span className="distance-text">{legLabel(i === 0 ? 0 : comparison.rows[i - 1]!.endMeters, row.endMeters, row.isFinish)}</span>
                    </th>
                    <td className="col-time">
                      <span className="estimate-time">{formatTenths(row.oldLegSeconds)}</span>
                      <span className="estimate-leg">{formatTenths(row.oldCumulativeSeconds)}</span>
                    </td>
                    <td className="col-time">
                      <span className="estimate-time">≈ {formatDuration(row.newLegSeconds, 0)}</span>
                      <span className="estimate-leg">≈ {formatDuration(row.newCumulativeSeconds, 0)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Big numbers: each stretch on its own. Small numbers: the running total at the end of it.</p>

          <details className="estimate-details">
            <summary>How this estimate works, and what it can't know</summary>
            <ul className="course-notes">
              <li>
                For each stretch, the hills of the old course are taken out of your time and the hills of the new course are put in.
                Your own pattern (a fast start, a fade, a kick) carries over; only the hills change.
              </li>
              <li>
                Hills use the same rule of thumb as the single-course estimate: about 3.4% slower for each 1% of uphill grade, and up to
                12% faster on a gentle descent, with no gain on very steep ones.
              </li>
              {comparison.oldUnrecordedShare > 0 || comparison.newUnrecordedShare > 0 ? (
                <li>
                  Stretches where a course has no recorded elevation are treated as flat
                  {comparison.oldUnrecordedShare > 0 ? ` (about ${Math.max(1, Math.round(comparison.oldUnrecordedShare * 100))}% of ${oldCourse.name})` : ""}
                  {comparison.newUnrecordedShare > 0 ? ` (about ${Math.max(1, Math.round(comparison.newUnrecordedShare * 100))}% of ${newCourse.name})` : ""}.
                </li>
              ) : null}
              <li>
                It does not know about the running surface, turns, wind or heat, the day's form, or how the old race was run.
                Elevation from a watch can be off by a few feet, and a course recorded on a training run may not be the exact
                race course.
              </li>
            </ul>
          </details>
        </section>
      ) : null}

      <section className="card" aria-labelledby="compare-profiles-heading">
        <h2 id="compare-profiles-heading" className="group-title">
          The two courses, side by side
        </h2>
        <p className="hint">Same miles across and same feet up on both, so a bigger hill looks bigger.</p>
        {[oldCourse, newCourse].map((c, i) => (
          <div key={`${i}-${c.id}`}>
            <h3 className="estimate-subtitle">
              {i === 0 ? "Old" : "New"}: {c.name}
            </h3>
            <StaticProfile course={c} xDomainMeters={domain} elevationScale={scale} />
          </div>
        ))}
      </section>
    </div>
  );
}
