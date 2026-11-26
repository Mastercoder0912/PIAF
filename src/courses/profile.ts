import { METERS_PER_MILE } from "../engine";
import { metersToFeet } from "./format";
import type { CourseData } from "./types";

/**
 * Geometry for the elevation profile, as plain numbers and path text so it can be tested without a browser.
 * The chart is drawn in pixels of the size it is shown at (no stretching), x = distance, y = elevation.
 */

export interface ProfileLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface AxisTick {
  /** Where it sits: meters along the course (x axis) or meters of elevation (y axis). */
  meters: number;
  label: string;
}

export interface Profile {
  layout: ProfileLayout;
  /** Left/right/top/bottom edges of the plotting area, in pixels. */
  plot: { left: number; right: number; top: number; bottom: number };
  x(distanceMeters: number): number;
  y(elevationMeters: number): number;
  /** Pixel x back to meters along the course, clamped to the course. */
  distanceAtX(px: number): number;
  linePath: string;
  areaPath: string;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
}

/** The smallest "nice" step that gives no more than `maxTicks` ticks over `span`. */
export function niceStep(span: number, maxTicks: number, steps: readonly number[]): number {
  for (const step of steps) if (span / step <= maxTicks) return step;
  return steps[steps.length - 1]!;
}

const FEET_STEPS = [5, 10, 20, 25, 50, 100, 200, 500] as const;
const MILE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** One elevation axis shared by several profiles: the same tick step and the same height in feet for all of them. */
export interface ElevationScale {
  feetStep: number;
  spanFeet: number;
}

export interface ProfileOptions {
  /** Draw the x axis out to this many meters instead of the course length (to put two courses on one scale). */
  xDomainMeters?: number;
  /** Use this elevation axis instead of one fitted to the course (see `sharedElevationScale`). */
  elevationScale?: ElevationScale;
}

/** The elevation axis that fits every given course, so their profiles can be drawn at the same feet-per-pixel. */
export function sharedElevationScale(courses: readonly CourseData[]): ElevationScale {
  const ranges = courses.map((c) => metersToFeet(c.elevation.maxMeters) - metersToFeet(c.elevation.minMeters));
  const feetStep = niceStep(Math.max(...ranges, 10), 4, FEET_STEPS);
  const needed = courses.map((c) => {
    const low = Math.floor(metersToFeet(c.elevation.minMeters) / feetStep) * feetStep;
    return Math.ceil(metersToFeet(c.elevation.maxMeters) / feetStep) * feetStep - low;
  });
  return { feetStep, spanFeet: Math.max(...needed, feetStep) };
}

export function buildProfile(course: CourseData, layout: ProfileLayout, maxXTicks = 6, options: ProfileOptions = {}): Profile {
  const { width, height, margin } = layout;
  const plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
  const plotWidth = Math.max(plot.right - plot.left, 1);
  const plotHeight = Math.max(plot.bottom - plot.top, 1);

  // Elevation axis in feet, rounded outward to nice values so the line never touches the frame.
  const minFt = metersToFeet(course.elevation.minMeters);
  const maxFt = metersToFeet(course.elevation.maxMeters);
  const feetStep = options.elevationScale?.feetStep ?? niceStep(Math.max(maxFt - minFt, 10), 4, FEET_STEPS);
  const lowFt = Math.floor(minFt / feetStep) * feetStep;
  const ownHighFt = Math.max(Math.ceil(maxFt / feetStep) * feetStep, lowFt + feetStep);
  // A shared scale is at least as tall as this course needs (it was built from it); never let the line leave the chart.
  const highFt = options.elevationScale === undefined ? ownHighFt : Math.max(lowFt + options.elevationScale.spanFeet, ownHighFt);
  const lowM = lowFt / metersToFeet(1);
  const highM = highFt / metersToFeet(1);

  const total = course.distanceMeters;
  const domain = Math.max(options.xDomainMeters ?? total, total);
  const x = (d: number) => plot.left + (Math.min(Math.max(d, 0), domain) / domain) * plotWidth;
  const y = (e: number) => plot.bottom - ((e - lowM) / (highM - lowM)) * plotHeight;
  const distanceAtX = (px: number) => Math.min((Math.max(px - plot.left, 0) / plotWidth) * domain, total);

  const coords = course.points.map((p) => `${fmt(x(p[3]))},${fmt(y(p[2]))}`);
  const linePath = `M${coords.join("L")}`;
  const areaPath = `${linePath}L${fmt(x(total))},${fmt(plot.bottom)}L${fmt(x(0))},${fmt(plot.bottom)}Z`;

  const yTicks: AxisTick[] = [];
  for (let ft = lowFt; ft <= highFt + 1e-9; ft += feetStep) yTicks.push({ meters: ft / metersToFeet(1), label: String(Math.round(ft)) });

  const totalMiles = domain / METERS_PER_MILE;
  const mileStep = niceStep(totalMiles, maxXTicks, MILE_STEPS);
  const xTicks: AxisTick[] = [];
  for (let k = 0; k * mileStep <= totalMiles + 1e-9; k++) {
    xTicks.push({ meters: k * mileStep * METERS_PER_MILE, label: fmt(k * mileStep) });
  }

  return { layout, plot, x, y, distanceAtX, linePath, areaPath, xTicks, yTicks };
}
