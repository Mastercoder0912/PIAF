import { automaticMarkerDistances, METERS_PER_MILE } from "../engine";
import type { CourseData } from "../courses/types";
import { legFactor, matchesCourse } from "./project";

/**
 * Course-to-course projection: "these are the leg times I ran on the OLD course; what would the same effort
 * look like on the NEW course?"
 *
 * For each leg of the race the hill effect of each course is worked out with the same rule as the single-course
 * estimate (src/adjust/model.ts). The runner's own leg time is then moved from one course to the other:
 *
 *     new leg time = old leg time x (new course factor / old course factor)
 *
 * Dividing by the old factor takes the old course's hills out of the time; multiplying by the new factor puts the
 * new course's hills in. Keeping the runner's own leg times (rather than an even pace) means a fade or a kick
 * carries over: only the hills change. Legs are the race's usual split legs: every whole mile, then the finish.
 *
 * Both courses must be about as long as the race (within 3%); each course is matched to the race in proportion.
 * Stretches where a course has no recorded elevation count as flat and are reported.
 */

export interface ComparisonRow {
  /** Where this leg ends, in race meters. */
  endMeters: number;
  isFinish: boolean;
  /** The runner's time for just this leg on the old course (as entered). */
  oldLegSeconds: number;
  /** Estimated time for just this leg on the new course. */
  newLegSeconds: number;
  oldCumulativeSeconds: number;
  newCumulativeSeconds: number;
  /** Estimated pace over this leg on the new course, seconds per mile. */
  newLegPaceSecondsPerMile: number;
  oldFactor: number;
  newFactor: number;
}

export interface Comparison {
  kind: "ok";
  raceMeters: number;
  oldCourseId: string;
  newCourseId: string;
  rows: ComparisonRow[];
  oldSeconds: number;
  newSeconds: number;
  /** new - old; positive = slower on the new course. */
  differenceSeconds: number;
  oldPaceSecondsPerMile: number;
  newPaceSecondsPerMile: number;
  oldUnrecordedShare: number;
  newUnrecordedShare: number;
}

export interface ComparisonMismatch {
  kind: "distance_mismatch";
  /** Which course doesn't fit the race distance. */
  which: "old" | "new";
  raceMeters: number;
  courseMeters: number;
}

export type ComparisonResult = Comparison | ComparisonMismatch;

/** Where each leg of a race of this length ends, in meters: every automatic marker, then the finish. */
export function legEnds(raceMeters: number): number[] {
  return [...automaticMarkerDistances(raceMeters), raceMeters];
}

/** `legSeconds` must have one positive time per leg, in the order of `legEnds(raceMeters)`. */
export function projectPerformance(
  raceMeters: number,
  legSeconds: readonly number[],
  oldCourse: CourseData,
  newCourse: CourseData,
): ComparisonResult {
  const ends = legEnds(raceMeters);
  if (legSeconds.length !== ends.length) {
    throw new RangeError(`Expected ${ends.length} leg times for a ${raceMeters} m race, got ${legSeconds.length}.`);
  }
  if (legSeconds.some((s) => !(s > 0) || !Number.isFinite(s))) throw new RangeError("Every leg time must be a positive number.");
  if (!matchesCourse(raceMeters, oldCourse.distanceMeters)) {
    return { kind: "distance_mismatch", which: "old", raceMeters, courseMeters: oldCourse.distanceMeters };
  }
  if (!matchesCourse(raceMeters, newCourse.distanceMeters)) {
    return { kind: "distance_mismatch", which: "new", raceMeters, courseMeters: newCourse.distanceMeters };
  }

  const oldScale = oldCourse.distanceMeters / raceMeters;
  const newScale = newCourse.distanceMeters / raceMeters;
  let previous = 0;
  let oldCumulative = 0;
  let newCumulative = 0;
  let oldUnrecorded = 0;
  let newUnrecorded = 0;

  const rows: ComparisonRow[] = ends.map((end, i) => {
    const oldLeg = legFactor(oldCourse, previous * oldScale, end * oldScale);
    const newLeg = legFactor(newCourse, previous * newScale, end * newScale);
    const oldSeconds = legSeconds[i]!;
    const newSeconds = (oldSeconds * newLeg.factor) / oldLeg.factor;
    oldCumulative += oldSeconds;
    newCumulative += newSeconds;
    oldUnrecorded += oldLeg.unrecordedMeters;
    newUnrecorded += newLeg.unrecordedMeters;
    const legMeters = end - previous;
    previous = end;
    return {
      endMeters: end,
      isFinish: i === ends.length - 1,
      oldLegSeconds: oldSeconds,
      newLegSeconds: newSeconds,
      oldCumulativeSeconds: oldCumulative,
      newCumulativeSeconds: newCumulative,
      newLegPaceSecondsPerMile: (newSeconds / legMeters) * METERS_PER_MILE,
      oldFactor: oldLeg.factor,
      newFactor: newLeg.factor,
    };
  });

  return {
    kind: "ok",
    raceMeters,
    oldCourseId: oldCourse.id,
    newCourseId: newCourse.id,
    rows,
    oldSeconds: oldCumulative,
    newSeconds: newCumulative,
    differenceSeconds: newCumulative - oldCumulative,
    oldPaceSecondsPerMile: (oldCumulative / raceMeters) * METERS_PER_MILE,
    newPaceSecondsPerMile: (newCumulative / raceMeters) * METERS_PER_MILE,
    oldUnrecordedShare: oldUnrecorded / oldCourse.distanceMeters,
    newUnrecordedShare: newUnrecorded / newCourse.distanceMeters,
  };
}
