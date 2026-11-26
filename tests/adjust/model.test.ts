import { describe, expect, it } from "vitest";
import { gradeFactor } from "../../src/adjust/model";

// Every expected value below is worked out by hand from the rule written in src/adjust/model.ts.
describe("gradeFactor (time multiplier for a grade, percent)", () => {
  it("is exactly 1 on flat ground, and for anything that is not a real number", () => {
    expect(gradeFactor(0)).toBe(1);
    expect(gradeFactor(Number.NaN)).toBe(1);
    expect(gradeFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("uphill: 1 + 0.034 g + 0.0021 g^2", () => {
    expect(gradeFactor(5)).toBeCloseTo(1 + 0.17 + 0.0525, 12); // 1.2225
    expect(gradeFactor(10)).toBeCloseTo(1 + 0.34 + 0.21, 12); // 1.55
    expect(gradeFactor(1)).toBeCloseTo(1.0361, 12);
  });

  it("uphill is capped at 20%: anything steeper counts as 20%", () => {
    expect(gradeFactor(20)).toBeCloseTo(1 + 0.68 + 0.84, 12); // 2.52
    expect(gradeFactor(35)).toBe(gradeFactor(20));
  });

  it("downhill: 12% faster at -9%, in a straight line from flat, then fading back to no gain at -18%", () => {
    expect(gradeFactor(-4.5)).toBeCloseTo(0.94, 12);
    expect(gradeFactor(-9)).toBeCloseTo(0.88, 12);
    expect(gradeFactor(-13.5)).toBeCloseTo(0.94, 12);
    expect(gradeFactor(-18)).toBeCloseTo(1, 12);
  });

  it("steeper descents than -18% get no gain at all (never a penalty, never a bonus)", () => {
    expect(gradeFactor(-25)).toBe(1);
    expect(gradeFactor(-80)).toBe(1);
  });

  it("is continuous around flat ground", () => {
    expect(gradeFactor(1e-9)).toBeCloseTo(1, 7);
    expect(gradeFactor(-1e-9)).toBeCloseTo(1, 7);
  });

  it("is never faster than 0.88 and increases steadily with uphill grade", () => {
    let previous = 0;
    for (let g = 0; g <= 20; g += 0.5) {
      expect(gradeFactor(g)).toBeGreaterThan(previous);
      previous = gradeFactor(g);
    }
    for (let g = -40; g <= 40; g += 0.25) expect(gradeFactor(g)).toBeGreaterThanOrEqual(0.88 - 1e-12);
  });

  it("costs more going up than it gains coming down, so equal up and down is slower than flat", () => {
    expect(gradeFactor(5) - 1).toBeGreaterThan(1 - gradeFactor(-5));
    expect((gradeFactor(5) + gradeFactor(-5)) / 2).toBeGreaterThan(1); // (1.2225 + 0.9333...) / 2 = 1.0779
    expect((gradeFactor(5) + gradeFactor(-5)) / 2).toBeCloseTo((1.2225 + (1 - (0.12 * 5) / 9)) / 2, 12);
  });
});
