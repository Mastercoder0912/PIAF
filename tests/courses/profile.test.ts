import { describe, expect, it } from "vitest";
import { buildProfile, niceStep, sharedElevationScale, type ProfileLayout } from "../../src/courses/profile";
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

  it("uses whole-mile ticks (0 to 3 for a 3.16 mi run) and 25 ft elevation ticks from 600 to 700 ft", () => {
    // Elevation 185.4..210.6 m = 608.3..690.9 ft: span 82.7 ft. 20 ft steps would need 82.7/20 = 4.1 ticks (over 4), so 25 ft; rounded out to 600..700.
    const profile = buildProfile(course, { width: 340, height: 220, margin: { top: 12, right: 12, bottom: 30, left: 44 } });
    expect(profile.xTicks.map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
    expect(profile.yTicks.map((t) => t.label)).toEqual(["600", "625", "650", "675", "700"]);
  });

  it("fits all 1353 points inside the chart at several widths", () => {
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

describe("buildProfile with a shared scale (used to compare two courses)", () => {
  const make = (distanceMeters: number, top: number) =>
    tinyCourse({
      distanceMeters,
      gaps: [],
      elevation: { minMeters: 0, maxMeters: top, startMeters: 0, endMeters: top, gainMeters: top, lossMeters: 0, method: "test" },
      points: [0, top / 2, top].map((e, i) => [34, -86 + i * 0.001, e, (i * distanceMeters) / 2] as [number, number, number, number]),
    });
  const short = make(100, 6);
  const tall = make(200, 50);
  const layout = { width: 400, height: 200, margin: { top: 10, right: 10, bottom: 30, left: 40 } };

  it("a shared x domain puts the shorter course's end part-way across, not at the right edge", () => {
    const own = buildProfile(short, layout);
    const shared = buildProfile(short, layout, 6, { xDomainMeters: 200 });
    expect(own.x(100)).toBe(own.plot.right);
    expect(shared.x(100)).toBeCloseTo((shared.plot.left + shared.plot.right) / 2, 9);
    expect(shared.distanceAtX(shared.plot.right)).toBe(100); // a touch beyond the course end clamps to the end
    expect(shared.x(200)).toBe(shared.plot.right);
  });

  it("a shared elevation scale is the same height and tick step for every course", () => {
    // short: 0..6 m = 0..19.7 ft; tall: 0..50 m = 0..164 ft. The range is 164 ft, so the step is 50 ft (164 / 50 = 3.3 <= 4).
    const scale = sharedElevationScale([short, tall]);
    expect(scale).toEqual({ feetStep: 50, spanFeet: 200 }); // tall needs 0..200 ft; short needs only 0..50
    const a = buildProfile(short, layout, 6, { elevationScale: scale });
    const b = buildProfile(tall, layout, 6, { elevationScale: scale });
    expect(a.yTicks.map((t) => t.label)).toEqual(["0", "50", "100", "150", "200"]);
    expect(b.yTicks.map((t) => t.label)).toEqual(["0", "50", "100", "150", "200"]);
    const feetPerPixel = (p: ReturnType<typeof buildProfile>, m: number) => (m * 3.28084) / (p.y(0) - p.y(m));
    expect(feetPerPixel(a, 20)).toBeCloseTo(feetPerPixel(b, 20), 6);
  });

  it("a course starting higher keeps the same height, with its own labels", () => {
    const high = tinyCourse({
      distanceMeters: 100,
      gaps: [],
      elevation: { minMeters: 300, maxMeters: 306, startMeters: 300, endMeters: 306, gainMeters: 6, lossMeters: 0, method: "test" },
      points: [[34, -86, 300, 0], [34.001, -86, 306, 100]],
    });
    const scale = sharedElevationScale([high, tall]);
    const p = buildProfile(high, layout, 6, { elevationScale: scale });
    expect(p.yTicks[0]!.label).toBe("950"); // 300 m = 984 ft, rounded down to a multiple of 50
    expect(p.yTicks.length).toBe(scale.spanFeet / scale.feetStep + 1);
  });

  it("an axis too small for the course is stretched rather than letting the line leave the chart", () => {
    const p = buildProfile(tall, layout, 6, { elevationScale: { feetStep: 50, spanFeet: 50 } });
    expect(p.y(50)).toBeGreaterThanOrEqual(p.plot.top);
  });

  it("the default behaviour is unchanged", () => {
    expect(buildProfile(tall, layout).yTicks).toEqual(buildProfile(tall, layout, 6, {}).yTicks);
  });
});
