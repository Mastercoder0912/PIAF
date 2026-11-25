/**
 * Elevation gain and loss.
 *
 * Method (also stored in each course's data, so the screen can say it): smooth the recorded
 * elevations with a centered 5-point moving average, then add up every rise (gain) and every fall (loss).
 * Smoothing is light on purpose: it takes the stair-step quantization out of a watch's 0.2 m readings
 * without flattening real hills. Different tools use different methods, so treat the result as an
 * estimate; the same file can give 10 to 20 percent different totals elsewhere.
 */
export const SMOOTHING_WINDOW = 5;

export const GAIN_METHOD =
  "Smoothed with a 5-point moving average, then every rise and fall added up. An estimate from a watch's elevation sensor.";

export function movingAverage(values: readonly number[], window: number = SMOOTHING_WINDOW): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += values[j] as number;
    return sum / (to - from + 1);
  });
}

export function gainAndLoss(elevations: readonly number[]): { gainMeters: number; lossMeters: number } {
  const smooth = movingAverage(elevations);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < smooth.length; i++) {
    const change = (smooth[i] as number) - (smooth[i - 1] as number);
    if (change > 0) gain += change;
    else loss -= change;
  }
  return { gainMeters: gain, lossMeters: loss };
}
