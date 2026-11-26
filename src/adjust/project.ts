import { METERS_PER_MILE } from "../engine/distance";
import type { RaceCalculation } from "../engine/types";
import { positionAt } from "../courses/position";
import type { CourseData } from "../courses/types";
import { gradeFactor } from "./model";

/**
 * Elevation-adjusted estimate for a race on a course.
 *
 * This is separate from the race engine on purpose: it only READS the engine's result (the flat target pace and
 * splits) and never changes it. The idea in one sentence: "if the runner gives the same effort they'd give at the
 * target pace on flat ground, roughly how long does each stretch of THIS course take?"
 *
 * Steps:
 *  1. The race must be about as long as the course (within COURSE_MATCH_TOLERANCE). If it is, the race distance
 *     is mapped onto the course in proportion (at most a 3% stretch), so the finish line is the end of the course.
 *  2. Each leg between two splits is cut into pieces of about STEP_METERS. For each piece the grade is measured
 *     over GRADE_WINDOW_METERS centred on it, and `gradeFactor` turns that grade into a time multiplier.
 *  3. Pieces whose window touches the stretch where nothing was recorded count as flat (factor 1): that
 *     elevation is unknown, so it is not guessed. The share of such pieces is reported.
 *  4. A leg's estimated time = flat time x the length-weighted average of its pieces' factors.
 */

export const COURSE_MATCH_TOLERANCE = 0.03;
export const STEP_METERS = 10;
export const GRADE_WINDOW_METERS = 100;

export interface ProjectionRow {
  id: string;
  label: string;
  isFinish: boolean;
  distanceMeters: number;
  /** The engine's own target time at this distance (untouched). */
  originalSeconds: number;
  /** Estimated time at this distance on this course. */
  estimatedSeconds: number;
  /** estimated - original; positive = slower than the flat target. */
  differenceSeconds: number;
  /** Estimated pace over just this leg, seconds per mile. */
  legPaceSecondsPerMile: number;
  /** Average time multiplier for this leg (1 = flat). */
  legFactor: number;
}

export interface Projection {
  kind: "ok";
  courseId: string;
  raceMeters: number;
  courseMeters: number;
  originalSeconds: number;
  originalPaceSecondsPerMile: number;
  estimatedSeconds: number;
  estimatedPaceSecondsPerMile: number;
  differenceSeconds: number;
  /** Share (0..1) of the course treated as flat because nothing was recorded there. */
  unrecordedShare: number;
  rows: ProjectionRow[];
}

export interface DistanceMismatch {
  kind: "distance_mismatch";
  raceMeters: number;
  courseMeters: number;
}

export type ProjectionResult = Projection | DistanceMismatch;

export function matchesCourse(raceMeters: number, courseMeters: number): boolean {
  return courseMeters > 0 && Math.abs(raceMeters - courseMeters) / courseMeters <= COURSE_MATCH_TOLERANCE;
}

function touchesGap(course: CourseData, lo: number, hi: number): boolean {
  return course.gaps.some((g) => g.startMeters < hi && g.endMeters > lo);
}

/** Grade in percent around `centre`, measured over a window that is kept inside the course. */
export function gradeAt(course: CourseData, centre: number): { gradePercent: number; touchesGap: boolean } {
  const length = course.distanceMeters;
  const window = Math.min(GRADE_WINDOW_METERS, length);
  let lo = centre - window / 2;
  let hi = centre + window / 2;
  if (lo < 0) {
    hi -= lo;
    lo = 0;
  }
  if (hi > length) {
    lo -= hi - length;
    hi = length;
  }
  lo = Math.max(lo, 0);
  const rise = positionAt(course, hi).elevationMeters - positionAt(course, lo).elevationMeters;
  return { gradePercent: hi > lo ? (rise / (hi - lo)) * 100 : 0, touchesGap: touchesGap(course, lo, hi) };
}

/** Average time multiplier over course meters [from, to], plus how many meters of it had no usable elevation. */
export function legFactor(course: CourseData, from: number, to: number): { factor: number; unrecordedMeters: number } {
  const span = to - from;
  if (!(span > 0)) return { factor: 1, unrecordedMeters: 0 };
  const n = Math.max(1, Math.ceil(span / STEP_METERS));
  const piece = span / n;
  let sum = 0;
  let unrecorded = 0;
  for (let i = 0; i < n; i++) {
    const { gradePercent, touchesGap: gap } = gradeAt(course, from + (i + 0.5) * piece);
    if (gap) {
      sum += 1;
      unrecorded += piece;
    } else {
      sum += gradeFactor(gradePercent);
    }
  }
  return { factor: sum / n, unrecordedMeters: unrecorded };
}

export function projectRace(race: RaceCalculation, course: CourseData): ProjectionResult {
  const raceMeters = race.totalDistanceMeters;
  const courseMeters = course.distanceMeters;
  if (!matchesCourse(raceMeters, courseMeters)) return { kind: "distance_mismatch", raceMeters, courseMeters };

  const scale = courseMeters / raceMeters;
  const secondsPerMeter = race.totalTimeSeconds / raceMeters;

  let previous = 0;
  let estimated = 0;
  let unrecordedCourseMeters = 0;
  const rows: ProjectionRow[] = race.splits.map((split) => {
    const legMeters = split.distanceMeters - previous;
    const { factor, unrecordedMeters } = legFactor(course, previous * scale, split.distanceMeters * scale);
    const legSeconds = secondsPerMeter * legMeters * factor;
    estimated += legSeconds;
    unrecordedCourseMeters += unrecordedMeters;
    previous = split.distanceMeters;
    return {
      id: split.id,
      label: split.label,
      isFinish: split.isFinish,
      distanceMeters: split.distanceMeters,
      originalSeconds: split.targetTimeSeconds,
      estimatedSeconds: estimated,
      differenceSeconds: estimated - split.targetTimeSeconds,
      legPaceSecondsPerMile: legMeters > 0 ? (legSeconds / legMeters) * METERS_PER_MILE : 0,
      legFactor: factor,
    };
  });

  return {
    kind: "ok",
    courseId: course.id,
    raceMeters,
    courseMeters,
    originalSeconds: race.totalTimeSeconds,
    originalPaceSecondsPerMile: race.paceSecondsPerMile,
    estimatedSeconds: estimated,
    estimatedPaceSecondsPerMile: (estimated / raceMeters) * METERS_PER_MILE,
    differenceSeconds: estimated - race.totalTimeSeconds,
    unrecordedShare: unrecordedCourseMeters / courseMeters,
    rows,
  };
}
