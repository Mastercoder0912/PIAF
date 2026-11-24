import { useEffect, useReducer } from "react";
import { formatStopwatch } from "../live/format";

interface StopwatchDisplayProps {
  /** Reads the stopwatch at this instant. The display never keeps its own count. */
  getElapsedSeconds: () => number;
  running: boolean;
}

/**
 * Large elapsed-time readout. While running it redraws on every animation frame, but each
 * frame only READS the elapsed time from the stopwatch's timestamps. If frames are skipped
 * or throttled (hidden tab, slow phone), the next frame simply shows the correct time.
 *
 * The frame loop is cancelled on pause and on unmount.
 */
export function StopwatchDisplay({ getElapsedSeconds, running }: StopwatchDisplayProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      redraw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const text = formatStopwatch(Math.max(0, getElapsedSeconds()));
  // role="timer" is not announced as it changes, so screen readers aren't flooded; the
  // screen announces events (started, paused, recorded) separately.
  return (
    <p className={text.length > 8 ? "stopwatch is-long" : "stopwatch"} role="timer" aria-label="Elapsed time">
      {text}
    </p>
  );
}
