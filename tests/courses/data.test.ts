// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, courseProblems } from "../../src/courses/build";
import { COURSES, getCourse } from "../../src/courses";
import type { CourseMeta } from "../../src/courses/types";

describe("every course shipped with the app", () => {
  it("has at least one, with unique ids", () => {
    expect(COURSES.length).toBeGreaterThan(0);
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length);
  });

  describe.each(COURSES.map((c) => [c.id, c] as const))("%s", (id, course) => {
    const dir = join("courses", id);
    const meta = JSON.parse(readFileSync(join(dir, "course.json"), "utf8")) as CourseMeta;
    const gpxBytes = readFileSync(join(dir, meta.gpx));

    it("passes the data checks", () => {
      expect(courseProblems(course)).toEqual([]);
    });

    it("has a folder named after its id, with an id that matches", () => {
      expect(meta.id).toBe(id);
    });

    it("is traceable to the original GPX: the stored fingerprint matches the file in the repository", () => {
      expect(course.source.sha256).toBe(createHash("sha256").update(gpxBytes).digest("hex"));
      expect(course.source.file).toBe(meta.gpx);
    });

    it("is exactly what the build produces from that GPX (the committed data can't drift or be hand-edited)", () => {
      const rebuilt = buildCourse(meta, gpxBytes.toString("utf8"), course.source.sha256);
      expect(course).toEqual(JSON.parse(JSON.stringify(rebuilt)));
    });
  });

  it("looks a course up by id", () => {
    expect(getCourse("john-hunt-park")?.name).toBe("John Hunt Park");
    expect(getCourse("nope")).toBeUndefined();
  });
});

describe("John Hunt Park: what was extracted from the supplied Garmin GPX", () => {
  // Expected values come from an independent analysis of the file (separate Python parsing, ellipsoidal distances).
  const course = getCourse("john-hunt-park")!;
  const original = readFileSync(join("courses", "john-hunt-park", "activity_24759595390.gpx"));

  it("the original GPX in the repository is the file that was supplied, byte for byte", () => {
    expect(createHash("sha256").update(original).digest("hex")).toBe("c86342865f0c24895332ecd792dcdce89fb880d58bf325aa371cae7482b02385");
  });

  it("has every recorded point (1190), with the file's own first and last coordinates and elevations", () => {
    expect(course.points).toHaveLength(1190);
    expect(course.source.pointCount).toBe(1190);
    expect(course.points[0]).toEqual([34.684907, -86.587065, 203.8, 0]);
    const last = course.points[course.points.length - 1]!;
    expect(last.slice(0, 3)).toEqual([34.686006, -86.584983, 185.8]);
  });

  it("measures 5,033.7 m (3.13 mi), the ellipsoidal length of the track", () => {
    expect(course.distanceMeters).toBe(5033.7);
  });

  it("has elevation from 183.0 to 206.2 m, starting at 203.8 m and ending at 185.8 m", () => {
    expect(course.elevation).toMatchObject({ minMeters: 183, maxMeters: 206.2, startMeters: 203.8, endMeters: 185.8 });
  });

  it("estimates 76.5 m of climbing and 94.5 m of descending", () => {
    expect(course.elevation.gainMeters).toBe(76.5);
    expect(course.elevation.lossMeters).toBe(94.5);
  });

  it("flags the one 41-second GPS/pause gap, about 704 m to 871 m", () => {
    expect(course.gaps).toEqual([{ startMeters: 703.9, endMeters: 871.2, seconds: 41 }]);
  });

  it("sits in Huntsville: its bounds contain the park's listed parking-lot location (34.68776, -86.58595)", () => {
    const [south, west, north, east] = course.bounds;
    expect(34.687757).toBeGreaterThan(south);
    expect(34.687757).toBeLessThan(north);
    expect(-86.585948).toBeGreaterThan(west);
    expect(-86.585948).toBeLessThan(east);
  });

  it("records where it came from", () => {
    expect(course.source).toMatchObject({ kind: "garmin-gpx", trackName: "Huntsville Running", creator: "Garmin Connect", recordedAt: "2026-10-17T15:00:35.000Z" });
  });

  it("says plainly that it is one recorded run, not a measured course", () => {
    expect(course.notes.join(" ")).toMatch(/not a measured or official race course/);
  });
});
