import {
  DISTANCE_TOLERANCE_METERS,
  METERS_PER_MILE,
  distancesEqual,
  formatDistanceLabel,
} from "./distance";
import { resolveRaceTarget, targetTimeAtDistance } from "./pace";
import { ok } from "./result";
import type { RaceCalculation, RaceConfig, Split, ValidationResult } from "./types";
import {
  MAX_SPLITS,
  estimateAutomaticSplitCount,
  estimateManualSplitCount,
  validateRaceConfig,
} from "./validation";

/**
 * Automatic splits depend on the race distance, and the three rules are mutually exclusive:
 *   - shorter than one mile:   every 200 m
 *   - exactly one mile:        every 400 m (but no 1600 m mark; see below)
 *   - longer than one mile:    whole-mile markers only (no sub-mile markers at all)
 * The finish is always added separately. "One mile" is the exact statute mile,
 * 1609.344 m (METERS_PER_MILE), never 1600 m.
 */
const SUB_MILE_INTERVAL_METERS = 200;
const ONE_MILE_INTERVAL_METERS = 400;

/** A marker only counts as "before the finish" if it is clearly short of it. */
function isBeforeFinish(markerMeters: number, totalDistanceMeters: number): boolean {
  return markerMeters < totalDistanceMeters - DISTANCE_TOLERANCE_METERS;
}

function assertWithinSplitLimit(count: number): void {
  if (count > MAX_SPLITS) {
    throw new RangeError(`Would generate ${count} splits (maximum ${MAX_SPLITS}). Validate the config first.`);
  }
}

/**
 * Sort ascending and drop any distance that equals (within tolerance) the one
 * before it. This is the guard behind "no duplicate distances".
 */
export function uniqueSortedDistances(distances: readonly number[]): number[] {
  const sorted = [...distances].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const distance of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || !distancesEqual(last, distance)) {
      unique.push(distance);
    }
  }
  return unique;
}

/**
 * Automatic-mode markers STRICTLY BEFORE the finish. The finish itself is added by buildSplits,
 * which is what makes a marker that coincides with the finish appear exactly once (as the finish).
 *
 *   total < 1 mile  : 200, 400, 600, ...   (every 200 m that is short of the finish)
 *   total = 1 mile  : 400, 800, 1200       (the 1600 m mark is NOT added: it is 9.344 m short of
 *                                           the finish and would read as a second mile marker)
 *   total > 1 mile  : 1 mile, 2 miles, ... (every whole mile that is short of the finish)
 *
 * Every marker is computed as k * step, never by repeated addition, so floating-point
 * error cannot accumulate across a long race.
 */
export function automaticMarkerDistances(totalDistanceMeters: number): number[] {
  assertWithinSplitLimit(estimateAutomaticSplitCount(totalDistanceMeters));

  const markers: number[] = [];
  if (distancesEqual(totalDistanceMeters, METERS_PER_MILE)) {
    // A mile is 4.02 laps of 400 m. Markers at laps 1..3; the 4-lap (1600 m) mark is left out.
    const wholeLaps = Math.floor(totalDistanceMeters / ONE_MILE_INTERVAL_METERS);
    for (let lap = 1; lap < wholeLaps; lap++) markers.push(lap * ONE_MILE_INTERVAL_METERS);
  } else if (totalDistanceMeters < METERS_PER_MILE) {
    for (let k = 1; isBeforeFinish(k * SUB_MILE_INTERVAL_METERS, totalDistanceMeters); k++) {
      markers.push(k * SUB_MILE_INTERVAL_METERS);
    }
  } else {
    for (let mile = 1; isBeforeFinish(mile * METERS_PER_MILE, totalDistanceMeters); mile++) {
      markers.push(mile * METERS_PER_MILE);
    }
  }
  return uniqueSortedDistances(markers);
}

/**
 * Manual-mode markers strictly before the finish: interval, 2*interval, ...
 * Computed as k * interval (not running sums) to avoid drift.
 * An interval >= race distance yields no markers: the race is just the finish.
 */
export function manualMarkerDistances(totalDistanceMeters: number, intervalMeters: number): number[] {
  assertWithinSplitLimit(estimateManualSplitCount(totalDistanceMeters, intervalMeters));

  const markers: number[] = [];
  for (let k = 1; isBeforeFinish(k * intervalMeters, totalDistanceMeters); k++) {
    markers.push(k * intervalMeters);
  }
  return uniqueSortedDistances(markers);
}

/**
 * Turn marker distances (all before the finish) into Split objects, appending
 * the finish line. The finish uses the exact total time so it never differs
 * from the goal by a floating-point sliver.
 */
export function buildSplits(
  markerDistances: readonly number[],
  totalDistanceMeters: number,
  totalTimeSeconds: number,
  paceSecondsPerMile: number,
): Split[] {
  const splits: Split[] = markerDistances.map((distanceMeters, index) => ({
    id: `split-${index + 1}`,
    distanceMeters,
    targetTimeSeconds: targetTimeAtDistance(distanceMeters, paceSecondsPerMile),
    label: formatDistanceLabel(distanceMeters),
    isFinish: false,
  }));

  splits.push({
    id: `split-${splits.length + 1}`,
    distanceMeters: totalDistanceMeters,
    targetTimeSeconds: totalTimeSeconds,
    label: `Finish (${formatDistanceLabel(totalDistanceMeters)})`,
    isFinish: true,
  });
  return splits;
}

/**
 * Main entry point: validate a RaceConfig, resolve time <-> pace, and generate
 * all splits. Never throws for bad user input; returns validation errors instead.
 */
export function calculateRace(config: RaceConfig): ValidationResult<RaceCalculation> {
  const validated = validateRaceConfig(config);
  if (!validated.ok) return validated;

  const { totalDistanceMeters, intervalMode, intervalDistanceMeters } = validated.value;
  const { totalTimeSeconds, paceSecondsPerMile } = resolveRaceTarget(totalDistanceMeters, validated.value);

  const markers =
    intervalMode === "manual"
      ? manualMarkerDistances(totalDistanceMeters, intervalDistanceMeters as number)
      : automaticMarkerDistances(totalDistanceMeters);

  return ok({
    totalDistanceMeters,
    totalTimeSeconds,
    paceSecondsPerMile,
    splits: buildSplits(markers, totalDistanceMeters, totalTimeSeconds, paceSecondsPerMile),
  });
}
