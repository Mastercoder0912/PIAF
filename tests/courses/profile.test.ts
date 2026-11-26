import { describe, expect, it } from "vitest";
import { buildProfile, niceStep, type ProfileLayout } from "../../src/courses/profile";
import { COURSES } from "../../src/courses";
import { tinyCourse } from "./helpers";

const layout: ProfileLayout = { width: 400, height: 200, margin: { top: 10, right: 20, bottom: 30, left: 50 } };
// Plot area: x 50..380 (330 wide), y 10..170 (160 tall).

describe("niceStep", () => {
  const miles = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  it("picks the smallest step that keeps the tick count within the limit", () => {
    expect(niceStep(3.13, 6, miles)).toBe(1); // 3.13 / 0.5 = 6.26 is over 6; 3.13 / 1 = 3.13 fits
    expect(niceStep(3.0, 6, miles)).toBe(0.5); // 3 / 0.5 = 6 fits exactly
    expect(niceStep(0.186, 6, miles)).toBe(0.1);
    expect(niceStep(26.2, 6, miles)).toBe(5);
  });
  it("falls back to the largest step rather than failing", () => {
    expect(niceStep(10000, 6, miles)).toBe(10);
  });
});

describe("buildProfile on a hand-made course", () => {
  // Elevation 10..20 m = 32.81..65.62 ft. Span 32.8 ft -> 10 ft steps (32.8/10 = 3.3 <= 4), rounded out to 30..70 ft.
  // 30 ft = 9.144 m and 70 ft = 21.336 m are the bottom and top of the chart.
  const profile = buildProfile(tinyCourse(), layout);

  it("lays out the plotting area inside the margins", () => {
    expect(profile.plot).toEqual({ left: 50, right: 380, top: 10, bottom: 170 });
  });

  it("maps distance to x: start at the left edge, finish at the right edge, halfway in the middle", () => {
    expect(profile.x(0)).toBe(50);
    expect(profile.x(300)).toBe(380);
    expect(profile.x(150)).toBe(215);
  });

  it("clamps x for distances outside the course", () => {
    expect(profile.x(-10)).toBe(50);
    expect(profile.x(1000)).toBe(380);
  });

  it("maps elevation to y with higher ground higher on screen", () => {
    expect(profile.y(30 / 3.280839895)).toBeCloseTo(170, 6); // bottom of the axis
    expect(profile.y(70 / 3.280839895)).toBeCloseTo(10, 6); // top of the axis
    // 15 m: (15 - 9.144) / (21.336 - 9.144) = 0.4803 of the way up the 160 px
    expect(profile.y(15)).toBeCloseTo(170 - 0.48031 * 160, 2);
    expect(profile.y(20)).toBeLessThan(profile.y(10));
  });

  it("maps a pixel back to a distance (the inverse of x), clamped to the course", () => {
    expect(profile.distanceAtX(215)).toBeCloseTo(150, 9);
    expect(profile.distanceAtX(50)).toBe(0);
    expect(profile.distanceAtX(380)).toBe(300);
    expect(profile.distanceAtX(0)).toBe(0);
    expect(profile.distanceAtX(5000)).toBe(300);
    for (const d of [0, 12.5, 100, 299.9]) expect(profile.distanceAtX(profile.x(d))).toBeCloseTo(d, 9);
  });

  it("draws one point per recorded point: a start, then a line segment to each of the rest", () => {
    expect(profile.linePath.startsWith("M50,158.8L")).toBe(true); // y(10 m) = 170 - 0.0702 * 160 = 158.77
    expect(profile.linePath.match(/L/g)).toHaveLength(3);
  });

  it("closes the filled area along the bottom edge", () => {
    expect(profile.areaPath.startsWith(profile.linePath)).toBe(true);
    expect(profile.areaPath.endsWith("L380,170L50,170Z")).toBe(true);
  });

  it("labels the elevation axis in feet at 10 ft steps, and the distance axis in miles", () => {
    expect(profile.yTicks.map((t) => t.label)).toEqual(["30", "40", "50", "60", "70"]);
    // 300 m is 0.186 mi: ticks at 0 and 0.1 mi
    expect(profile.xTicks.map((t) => t.label)).toEqual(["0", "0.1"]);
    expect(profile.xTicks[1]?.meters).toBeCloseTo(160.9344, 6);
  });

  it("keeps every point of the line inside the plotting area", () => {
    for (const [, , ele, dist] of tinyCourse().points) {
      expect(profile.y(ele)).toBeGreaterThanOrEqual(10);
      expect(profile.y(ele)).toBeLessThanOrEqual(170);
      expect(profile.x(dist)).toBeGreaterThanOrEqual(50);
      expect(profile.x(dist)).toBeLessThanOrEqual(380);
    }
  });
});

describe("buildProfile on the John Hunt Park data", () => {
  const course = COURSES.find((c) => c.id === "john-hunt-park")!;

  it("uses whole-mile ticks (0 to 3 for a 3.13 mi run) and 20 ft elevation ticks from 600 to 680 ft", () => {
    // Elevation 183.0..206.2 m = 600.4..676.5 ft: span 76 ft -> 20 ft steps (76/10 = 7.6 is over 4), rounded out to 600..680.
    const profile = buildProfile(course, { width: 340, height: 220, margin: { top: 12, right: 12, bottom: 30, left: 44 } });
    expect(profile.xTicks.map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
    expect(profile.yTicks.map((t) => t.label)).toEqual(["600", "620", "640", "660", "680"]);
  });

  it("fits all 1190 points inside the chart at several widths", () => {
    for (const width of [280, 320, 390, 600, 1000]) {
      const profile = buildProfile(course, { width, height: 220, margin: { top: 12, right: 12, bottom: 30, left: 44 } });
      expect(profile.linePath.match(/L/g)).toHaveLength(course.points.length - 1);
      for (const p of course.points) {
        expect(profile.x(p[3])).toBeGreaterThanOrEqual(profile.plot.left);
        expect(profile.x(p[3])).toBeLessThanOrEqual(profile.plot.right);
        expect(profile.y(p[2])).toBeGreaterThanOrEqual(profile.plot.top);
        expect(profile.y(p[2])).toBeLessThanOrEqual(profile.plot.bottom);
      }
    }
  });

  it("survives a chart that is too small for its margins", () => {
    const profile = buildProfile(course, { width: 40, height: 40, margin: { top: 12, right: 12, bottom: 30, left: 44 } });
    expect(Number.isFinite(profile.x(100))).toBe(true);
    expect(Number.isFinite(profile.y(190))).toBe(true);
    expect(profile.linePath).not.toMatch(/NaN|Infinity/);
  });
});
