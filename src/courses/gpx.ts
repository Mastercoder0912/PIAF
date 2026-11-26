/**
 * GPX reading. Strict on purpose: if a file is missing something a course needs, we say exactly what
 * and stop. Nothing is filled in or guessed.
 *
 * Needs a global `DOMParser` (any browser; in tests and in the build script it comes from jsdom).
 * Only track points (<trkpt>) are read. Route-only files (<rte>) are reported as unsupported.
 */

export type GpxErrorCode =
  | "not_xml"
  | "not_gpx"
  | "no_track_points"
  | "bad_coordinates"
  | "too_few_points"
  | "missing_elevation";

export class GpxError extends Error {
  readonly code: GpxErrorCode;
  constructor(code: GpxErrorCode, message: string) {
    super(message);
    this.name = "GpxError";
    this.code = code;
  }
}

export interface GpxPoint {
  lat: number;
  lon: number;
  /** Meters, or null if this point had no usable <ele>. */
  ele: number | null;
  /** Milliseconds since 1970, or null if this point had no usable <time>. */
  timeMs: number | null;
  /** Which <trkseg> (0-based, counted across all tracks) the point belongs to. */
  segment: number;
}

export interface ParsedGpx {
  trackName: string | null;
  creator: string | null;
  points: GpxPoint[];
  segmentCount: number;
}

const childText = (parent: Element, tag: string): string | null => {
  const el = parent.getElementsByTagNameNS("*", tag)[0];
  const text = el?.textContent?.trim();
  return text ? text : null;
};

function toNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseGpx(xml: string): ParsedGpx {
  if (typeof xml !== "string" || xml.trim() === "") throw new GpxError("not_xml", "The file is empty.");

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    throw new GpxError("not_xml", "The file is not valid XML.");
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new GpxError("not_xml", "The file is not valid XML.");
  }

  const root = doc.documentElement;
  if (!root || root.localName !== "gpx") {
    throw new GpxError("not_gpx", "The file is XML but not a GPX file (no <gpx> element).");
  }

  const tracks = Array.from(root.getElementsByTagNameNS("*", "trk"));
  const points: GpxPoint[] = [];
  let segment = 0;
  for (const track of tracks) {
    for (const seg of Array.from(track.getElementsByTagNameNS("*", "trkseg"))) {
      for (const pt of Array.from(seg.getElementsByTagNameNS("*", "trkpt"))) {
        const lat = toNumber(pt.getAttribute("lat"));
        const lon = toNumber(pt.getAttribute("lon"));
        const index = points.length + 1;
        if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          throw new GpxError("bad_coordinates", `Track point ${index} has a missing or invalid latitude/longitude.`);
        }
        const time = childText(pt, "time");
        const parsedTime = time === null ? NaN : Date.parse(time);
        points.push({
          lat,
          lon,
          ele: toNumber(childText(pt, "ele")),
          timeMs: Number.isFinite(parsedTime) ? parsedTime : null,
          segment,
        });
      }
      segment++;
    }
  }

  if (points.length === 0) {
    const hasRoute = root.getElementsByTagNameNS("*", "rtept").length > 0;
    throw new GpxError(
      "no_track_points",
      hasRoute
        ? "The file has a planned route (<rte>) but no recorded track. Only tracks are supported."
        : "The file has no track points.",
    );
  }

  return {
    trackName: tracks[0] ? childText(tracks[0], "name") : null,
    creator: root.getAttribute("creator"),
    points,
    segmentCount: segment,
  };
}
