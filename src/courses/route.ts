import type { CourseData } from "./types";

/**
 * Splits the route into the parts to draw solid (recorded) and dashed (a straight line across a stretch
 * where nothing was recorded). Pure, so the rule can be tested without a map.
 */

export type LatLng = [lat: number, lon: number];

export interface RouteParts {
  /** Each entry is one connected stretch, as a list of [lat, lon]. */
  solid: LatLng[][];
  dashed: LatLng[][];
}

const EPS = 1e-6;

/** True when the step a -> b spans a recorded silence (it starts at or after a gap's start and ends at or before its end). */
function isGapStep(course: CourseData, a: CourseData["points"][number], b: CourseData["points"][number]): boolean {
  return b[3] > a[3] && course.gaps.some((g) => a[3] >= g.startMeters - EPS && b[3] <= g.endMeters + EPS);
}

export function routeParts(course: CourseData): RouteParts {
  const { points } = course;
  const solid: LatLng[][] = [];
  const dashed: LatLng[][] = [];
  let current: LatLng[] = [];
  let currentIsDashed = false;

  const flush = () => {
    if (current.length >= 2) (currentIsDashed ? dashed : solid).push(current);
    current = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const inGap = isGapStep(course, a, b);
    if (current.length > 0 && inGap !== currentIsDashed) flush();
    if (current.length === 0) {
      currentIsDashed = inGap;
      current.push([a[0], a[1]]);
    }
    current.push([b[0], b[1]]);
  }
  flush();
  return { solid, dashed };
}

/**
 * Route color by elevation: the lowest point of the course is green, the highest is red, and everything in
 * between is a smooth gradient through yellow. Done in HSL so the hue runs straight from 120 (green) to 0 (red).
 */
export const GRADIENT_SATURATION = 85;
export const GRADIENT_LIGHTNESS = 45;

/** Position within the course's elevation range: 0 at the lowest point, 1 at the highest. A flat course counts as 0. */
export function elevationFraction(elevationMeters: number, minMeters: number, maxMeters: number): number {
  const range = maxMeters - minMeters;
  if (!(range > 0)) return 0;
  return Math.min(Math.max((elevationMeters - minMeters) / range, 0), 1);
}

/** Hue in degrees for a fraction: 120 (green) at 0, 60 (yellow) at 0.5, 0 (red) at 1. */
export const elevationHue = (fraction: number) => 120 * (1 - Math.min(Math.max(fraction, 0), 1));

/** CSS color for a fraction. The hue is rounded to a whole degree, which is far finer than the eye can tell apart. */
export const elevationColor = (fraction: number) =>
  `hsl(${Math.round(elevationHue(fraction))}, ${GRADIENT_SATURATION}%, ${GRADIENT_LIGHTNESS}%)`;

export interface ColoredRun {
  color: string;
  /** A connected stretch of the recorded route; the next run starts at this one's last point. */
  points: LatLng[];
}

/** The route is drawn in this many distinct shades (5 degrees of hue each, green to red); fine enough to read as a smooth gradient. */
export const COLOR_STEPS = 24;
const quantize = (fraction: number) => Math.round(fraction * COLOR_STEPS) / COLOR_STEPS;

/**
 * The recorded route (not the gaps) as runs of one color each. Each step between two points takes the color
 * of its average elevation; consecutive steps with the same color are merged into one run, so the map draws
 * far fewer lines than there are GPS points. Colors are quantized to COLOR_STEPS shades.
 */
export function elevationRuns(course: CourseData): ColoredRun[] {
  const { points } = course;
  const { minMeters, maxMeters } = course.elevation;
  const runs: ColoredRun[] = [];
  let current: ColoredRun | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (isGapStep(course, a, b)) {
      current = null;
      continue;
    }
    const color = elevationColor(quantize(elevationFraction((a[2] + b[2]) / 2, minMeters, maxMeters)));
    if (current && current.color === color) {
      current.points.push([b[0], b[1]]);
    } else {
      current = { color, points: [[a[0], a[1]], [b[0], b[1]]] };
      runs.push(current);
    }
  }
  return runs;
}
