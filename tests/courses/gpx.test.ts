// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GpxError, parseGpx } from "../../src/courses/gpx";
import { gpx } from "./helpers";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof GpxError ? error.code : `other:${String(error)}`;
  }
  return undefined;
}

describe("parseGpx: reading a valid file", () => {
  it("reads coordinates, elevation, time, track name and creator", () => {
    const parsed = parseGpx(
      gpx([[{ lat: 34.5, lon: -86.25, ele: 203.8, time: "2026-10-17T15:00:35.000Z" }, { lat: 34.6, lon: -86.35, ele: 204.2, time: "2026-10-17T15:00:36.000Z" }]], {
        creator: "Garmin Connect",
        name: "Huntsville Running",
      }),
    );
    expect(parsed.trackName).toBe("Huntsville Running");
    expect(parsed.creator).toBe("Garmin Connect");
    expect(parsed.segmentCount).toBe(1);
    expect(parsed.points).toEqual([
      { lat: 34.5, lon: -86.25, ele: 203.8, timeMs: Date.UTC(2026, 9, 17, 15, 0, 35), segment: 0 },
      { lat: 34.6, lon: -86.35, ele: 204.2, timeMs: Date.UTC(2026, 9, 17, 15, 0, 36), segment: 0 },
    ]);
  });

  it("ignores extension elements such as heart rate (Garmin namespace)", () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg>
      <trkpt lat="1" lon="2"><ele>3</ele><extensions><ns3:TrackPointExtension><ns3:hr>150</ns3:hr></ns3:TrackPointExtension></extensions></trkpt></trkseg></trk></gpx>`;
    expect(parseGpx(text).points).toEqual([{ lat: 1, lon: 2, ele: 3, timeMs: null, segment: 0 }]);
  });

  it("numbers segments across the whole file", () => {
    const parsed = parseGpx(gpx([[{ lat: 1, lon: 1 }, { lat: 1, lon: 1.001 }], [{ lat: 2, lon: 2 }]]));
    expect(parsed.segmentCount).toBe(2);
    expect(parsed.points.map((p) => p.segment)).toEqual([0, 0, 1]);
  });

  it("reports missing or unusable elevation and time as null, never as 0", () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="1" lon="2"></trkpt>
      <trkpt lat="1" lon="2"><ele>abc</ele><time>not a time</time></trkpt>
      <trkpt lat="1" lon="2"><ele></ele></trkpt></trkseg></trk></gpx>`;
    for (const p of parseGpx(text).points) {
      expect(p.ele).toBeNull();
      expect(p.timeMs).toBeNull();
    }
  });

  it("keeps a genuine elevation of 0", () => {
    expect(parseGpx(gpx([[{ lat: 1, lon: 1, ele: 0 }]])).points[0]?.ele).toBe(0);
  });

  it("accepts a file with no creator or track name", () => {
    const parsed = parseGpx(`<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele></trkpt></trkseg></trk></gpx>`);
    expect(parsed.creator).toBeNull();
    expect(parsed.trackName).toBeNull();
  });
});

describe("parseGpx: invalid input is refused with a clear reason", () => {
  it.each([
    ["an empty string", ""],
    ["only spaces", "   \n "],
  ])("%s", (_label, text) => {
    expect(codeOf(() => parseGpx(text))).toBe("not_xml");
  });

  it("text that is not XML", () => {
    expect(codeOf(() => parseGpx("this is not xml"))).toBe("not_xml");
    expect(codeOf(() => parseGpx("<gpx><trk></gpx>"))).toBe("not_xml"); // unclosed tag
  });

  it("XML that is not GPX", () => {
    expect(codeOf(() => parseGpx(`<?xml version="1.0"?><kml><Placemark/></kml>`))).toBe("not_gpx");
  });

  it("a GPX with no track points", () => {
    expect(codeOf(() => parseGpx(`<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>`))).toBe("no_track_points");
    expect(codeOf(() => parseGpx(`<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg></trkseg></trk></gpx>`))).toBe("no_track_points");
  });

  it("a planned route (rtept) without a recorded track says so", () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="1" lon="2"/></rte></gpx>`;
    expect(() => parseGpx(text)).toThrow(/planned route/);
    expect(codeOf(() => parseGpx(text))).toBe("no_track_points");
  });

  it.each([
    ["latitude over 90", `<trkpt lat="91" lon="2"/>`],
    ["latitude under -90", `<trkpt lat="-90.5" lon="2"/>`],
    ["longitude over 180", `<trkpt lat="1" lon="181"/>`],
    ["longitude under -180", `<trkpt lat="1" lon="-180.1"/>`],
    ["a non-numeric latitude", `<trkpt lat="north" lon="2"/>`],
    ["a missing longitude", `<trkpt lat="1"/>`],
    ["an empty latitude", `<trkpt lat="" lon="2"/>`],
    ["an infinite value", `<trkpt lat="Infinity" lon="2"/>`],
  ])("%s", (_label, point) => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="1" lon="1"/>${point}</trkseg></trk></gpx>`;
    expect(codeOf(() => parseGpx(text))).toBe("bad_coordinates");
    expect(() => parseGpx(text)).toThrow(/Track point 2/); // names the point
  });

  it("accepts the coordinate limits themselves", () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="90" lon="180"/><trkpt lat="-90" lon="-180"/></trkseg></trk></gpx>`;
    expect(parseGpx(text).points).toHaveLength(2);
  });
});
