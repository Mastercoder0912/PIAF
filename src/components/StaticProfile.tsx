import { useMemo } from "react";
import { formatDistance } from "../courses/format";
import { buildProfile, type ElevationScale } from "../courses/profile";
import type { CourseData } from "../courses/types";
import { useElementWidth } from "../state/useElementWidth";

const HEIGHT = 150;
const MARGIN = { top: 10, right: 14, bottom: 26, left: 46 };

/**
 * A read-only elevation profile. `xDomainMeters` and `spanFeet` let two of these share one scale
 * (same miles across, same feet up), so a hill that looks bigger really is bigger.
 */
export function StaticProfile({
  course,
  xDomainMeters,
  elevationScale,
}: {
  course: CourseData;
  xDomainMeters: number;
  elevationScale: ElevationScale;
}) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>(340);
  const profile = useMemo(
    () => buildProfile(course, { width, height: HEIGHT, margin: MARGIN }, 6, { xDomainMeters, elevationScale }),
    [course, width, xDomainMeters, elevationScale],
  );

  return (
    <div ref={hostRef} className="profile-host">
      <svg
        className="profile profile-static"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Elevation profile of ${course.name}, ${formatDistance(course.distanceMeters)}.`}
      >
        {profile.yTicks.map((tick) => (
          <g key={`y-${tick.label}`}>
            <line className="profile-grid" x1={profile.plot.left} x2={profile.plot.right} y1={profile.y(tick.meters)} y2={profile.y(tick.meters)} />
            <text className="profile-tick" x={profile.plot.left - 6} y={profile.y(tick.meters)} textAnchor="end" dominantBaseline="middle">
              {tick.label}
            </text>
          </g>
        ))}
        {profile.xTicks.map((tick) => (
          <g key={`x-${tick.label}`}>
            <line className="profile-tick-mark" x1={profile.x(tick.meters)} x2={profile.x(tick.meters)} y1={profile.plot.bottom} y2={profile.plot.bottom + 5} />
            <text className="profile-tick" x={profile.x(tick.meters)} y={profile.plot.bottom + 18} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
        {course.gaps.map((gap) => (
          <rect
            key={`${gap.startMeters}-${gap.endMeters}`}
            className="profile-gap"
            x={profile.x(gap.startMeters)}
            y={profile.plot.top}
            width={Math.max(profile.x(gap.endMeters) - profile.x(gap.startMeters), 2)}
            height={profile.plot.bottom - profile.plot.top}
          />
        ))}
        <path className="profile-area" d={profile.areaPath} />
        <path className="profile-line" d={profile.linePath} />
      </svg>
    </div>
  );
}
