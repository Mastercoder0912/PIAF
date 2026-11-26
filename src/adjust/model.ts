/**
 * Hill effect on pace: one small, documented rule. It is a planning rule of thumb, NOT a measurement and not
 * a physiology model. Everything that can be tuned is a named constant here so it can be reviewed and changed.
 *
 * The factor multiplies TIME, so 1.00 = same pace as flat ground, 1.20 = 20% slower, 0.90 = 10% faster.
 * `grade` is in percent (5 = rises 5 m per 100 m).
 *
 *   Uphill  (grade >= 0):  1 + 0.034 g + 0.0021 g^2        about 3.4% slower per 1% of grade, a little more on steep hills.
 *                          This is the pace-planning factor used by the Ultrapacer tool, as reported at
 *                          educatedguesswork.org/posts/grade-vs-pace (not a peer-reviewed measurement).
 *   Downhill (grade < 0):  gains are smaller than the uphill costs, which is why a rolling course is slower than a
 *                          flat one. Fastest at -9% (12% faster), fading back to no gain at -18%, taken from
 *                          Strava Engineering, "An Improved GAP Model": minimum factor 0.88 at -9%, back to 1.0 at -18%
 *                          (fit to about 6 million real runs). Straight lines between those points are this app's simplification.
 *   Beyond the limits: grades steeper than UPHILL_CAP_PERCENT are treated as that grade; steeper descents than
 *                      DOWNHILL_NO_GAIN_PERCENT get no gain at all (braking cancels it).
 */

export const UPHILL_LINEAR = 0.034;
export const UPHILL_QUADRATIC = 0.0021;
export const UPHILL_CAP_PERCENT = 20;

export const DOWNHILL_BEST_PERCENT = 9;
export const DOWNHILL_BEST_FACTOR = 0.88;
export const DOWNHILL_NO_GAIN_PERCENT = 18;

/** Time multiplier for running at a given grade (percent). 1 on flat ground; NaN/Infinity count as flat. */
export function gradeFactor(gradePercent: number): number {
  if (!Number.isFinite(gradePercent) || gradePercent === 0) return 1;
  if (gradePercent > 0) {
    const g = Math.min(gradePercent, UPHILL_CAP_PERCENT);
    return 1 + UPHILL_LINEAR * g + UPHILL_QUADRATIC * g * g;
  }
  const down = -gradePercent;
  if (down >= DOWNHILL_NO_GAIN_PERCENT) return 1;
  const gain = 1 - DOWNHILL_BEST_FACTOR; // 0.12
  if (down <= DOWNHILL_BEST_PERCENT) return 1 - (gain * down) / DOWNHILL_BEST_PERCENT;
  return DOWNHILL_BEST_FACTOR + (gain * (down - DOWNHILL_BEST_PERCENT)) / (DOWNHILL_NO_GAIN_PERCENT - DOWNHILL_BEST_PERCENT);
}
