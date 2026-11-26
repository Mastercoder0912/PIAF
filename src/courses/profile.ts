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

export function buildProfile(course: CourseData, layout: ProfileLayout, maxXTicks = 6): Profile {
  const { width, height, margin } = layout;
  const plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
  const plotWidth = Math.max(plot.right - plot.left, 1);
  const plotHeight = Math.max(plot.bottom - plot.top, 1);

  // Elevation axis in feet, rounded outward to nice values so the line never touches the frame.
  const minFt = metersToFeet(course.elevation.minMeters);
  const maxFt = metersToFeet(course.elevation.maxMeters);
  const feetStep = niceStep(Math.max(maxFt - minFt, 10), 4, FEET_STEPS);
  const lowFt = Math.floor(minFt / feetStep) * feetStep;
  const highFt = Math.max(Math.ceil(maxFt / feetStep) * feetStep, lowFt + feetStep);
  const lowM = lowFt / metersToFeet(1);
  const highM = highFt / metersToFeet(1);

  const total = course.distanceMeters;
  const x = (d: number) => plot.left + (Math.min(Math.max(d, 0), total) / total) * plotWidth;
  const y = (e: number) => plot.bottom - ((e - lowM) / (highM - lowM)) * plotHeight;
  const distanceAtX = (px: number) => (Math.min(Math.max(px - plot.left, 0), plotWidth) / plotWidth) * total;

  const coords = course.points.map((p) => `${fmt(x(p[3]))},${fmt(y(p[2]))}`);
  const linePath = `M${coords.join("L")}`;
  const areaPath = `${linePath}L${fmt(x(total))},${fmt(plot.bottom)}L${fmt(x(0))},${fmt(plot.bottom)}Z`;

  const yTicks: AxisTick[] = [];
  for (let ft = lowFt; ft <= highFt + 1e-9; ft += feetStep) yTicks.push({ meters: ft / metersToFeet(1), label: String(Math.round(ft)) });

  const totalMiles = total / METERS_PER_MILE;
  const mileStep = niceStep(totalMiles, maxXTicks, MILE_STEPS);
  const xTicks: AxisTick[] = [];
  for (let k = 0; k * mileStep <= totalMiles + 1e-9; k++) {
    xTicks.push({ meters: k * mileStep * METERS_PER_MILE, label: fmt(k * mileStep) });
  }

  return { layout, plot, x, y, distanceAtX, linePath, areaPath, xTicks, yTicks };
}
