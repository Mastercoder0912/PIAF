import { useMemo, useRef, type PointerEvent } from "react";
import { formatDistance, formatElevation } from "../courses/format";
import { buildProfile } from "../courses/profile";
import type { CourseData, CoursePosition } from "../courses/types";
import { useElementWidth } from "../state/useElementWidth";

const HEIGHT = 210;
const MARGIN = { top: 14, right: 14, bottom: 30, left: 46 };

/**
 * The elevation profile: distance across, elevation up. Draws the cursor at `position` and lets the coach
 * scrub it with a finger or mouse (horizontal drags; vertical drags still scroll the page on a phone).
 * It only reports a distance through `onScrub`; the parent owns the position.
 */
export function ElevationProfile({
  course,
  position,
  onScrub,
}: {
  course: CourseData;
  position: CoursePosition;
  onScrub: (distanceMeters: number) => void;
}) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>(340);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const profile = useMemo(() => buildProfile(course, { width, height: HEIGHT, margin: MARGIN }), [course, width]);

  const scrubTo = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    onScrub(profile.distanceAtX(event.clientX - rect.left));
  };

  const cursorX = profile.x(position.distanceMeters);
  const cursorY = profile.y(position.elevationMeters);

  return (
    <div ref={hostRef} className="profile-host">
      <svg
        ref={svgRef}
        className="profile"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Elevation profile of ${course.name}, ${formatDistance(course.distanceMeters)}. Cursor at ${formatDistance(position.distanceMeters)}, elevation ${formatElevation(position.elevationMeters)}.`}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          scrubTo(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) scrubTo(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {/* Horizontal grid and elevation labels (feet) */}
        {profile.yTicks.map((tick) => (
          <g key={`y-${tick.label}`}>
            <line className="profile-grid" x1={profile.plot.left} x2={profile.plot.right} y1={profile.y(tick.meters)} y2={profile.y(tick.meters)} />
            <text className="profile-tick" x={profile.plot.left - 6} y={profile.y(tick.meters)} textAnchor="end" dominantBaseline="middle">
              {tick.label}
            </text>
          </g>
        ))}
        {/* Distance labels (miles) */}
        {profile.xTicks.map((tick) => (
          <g key={`x-${tick.label}`}>
            <line className="profile-tick-mark" x1={profile.x(tick.meters)} x2={profile.x(tick.meters)} y1={profile.plot.bottom} y2={profile.plot.bottom + 5} />
            <text className="profile-tick" x={profile.x(tick.meters)} y={profile.plot.bottom + 18} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {/* Stretches where nothing was recorded */}
        {course.gaps.map((gap) => (
          <rect
            key={`${gap.startMeters}-${gap.endMeters}`}
            className="profile-gap"
            data-testid="profile-gap"
            x={profile.x(gap.startMeters)}
            y={profile.plot.top}
            width={Math.max(profile.x(gap.endMeters) - profile.x(gap.startMeters), 2)}
            height={profile.plot.bottom - profile.plot.top}
          />
        ))}

        <path className="profile-area" d={profile.areaPath} />
        <path className="profile-line" d={profile.linePath} />

        {/* The current position */}
        <line className="profile-cursor" data-testid="profile-cursor" x1={cursorX} x2={cursorX} y1={profile.plot.top} y2={profile.plot.bottom} />
        <circle
          className={position.inGap ? "profile-dot is-gap" : "profile-dot"}
          data-testid="profile-dot"
          cx={cursorX}
          cy={cursorY}
          r={7}
        />
      </svg>
    </div>
  );
}
