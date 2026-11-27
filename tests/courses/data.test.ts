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
  // Expected values come from an independent analysis of the file (separate Python parsing: point count, the file's own
  // elevations and times, a spherical length, and a 5-point moving-average gain/loss).
  const course = getCourse("john-hunt-park")!;
  const original = readFileSync(join("courses", "john-hunt-park", "activity_17324737500.gpx"));

  it("the original GPX in the repository is the file that was supplied, byte for byte", () => {
    expect(createHash("sha256").update(original).digest("hex")).toBe("f9833aef3d12c279716f652b511eb15e1d292a65f7a1d0aff95045bbee29f736");
  });

  it("has every recorded point (1353), with the file's own first and last coordinates and elevations", () => {
    expect(course.points).toHaveLength(1353);
    expect(course.source.pointCount).toBe(1353);
    expect(course.points[0]).toEqual([34.68488, -86.587108, 204, 0]);
    const last = course.points[course.points.length - 1]!;
    expect(last.slice(0, 3)).toEqual([34.686263, -86.584839, 185.4]);
  });

  it("measures 5,092.4 m (3.16 mi), within 0.1% of the independent spherical length (5,095.1 m)", () => {
    expect(course.distanceMeters).toBe(5092.4);
    expect(Math.abs(course.distanceMeters - 5095.1) / 5095.1).toBeLessThan(0.001);
  });

  it("has elevation from 185.4 to 210.6 m, starting at 204.0 m and ending at 185.4 m", () => {
    expect(course.elevation).toMatchObject({ minMeters: 185.4, maxMeters: 210.6, startMeters: 204, endMeters: 185.4 });
  });

  it("estimates 39.3 m of climbing and 57.8 m of descending", () => {
    expect(course.elevation.gainMeters).toBe(39.3);
    expect(course.elevation.lossMeters).toBe(57.8);
  });

  it("has no unrecorded gap (the watch logged every second)", () => {
    expect(course.gaps).toEqual([]);
  });

  it("sits in Huntsville: its bounds contain the park's listed parking-lot location (34.68776, -86.58595)", () => {
    const [south, west, north, east] = course.bounds;
    expect(34.687757).toBeGreaterThan(south);
    expect(34.687757).toBeLessThan(north);
    expect(-86.585948).toBeGreaterThan(west);
    expect(-86.585948).toBeLessThan(east);
  });

  it("records where it came from", () => {
    expect(course.source).toMatchObject({ kind: "garmin-gpx", trackName: "Huntsville Running", creator: "Garmin Connect", recordedAt: "2024-10-19T15:00:01.000Z" });
  });

  it("says plainly that it is one recorded run, not a measured course", () => {
    expect(course.notes.join(" ")).toMatch(/not a measured or official race course/);
  });
});

describe("the five courses added from the coach's Garmin GPX files", () => {
  // Expected values come from a separate Python reading of each original file: point count, the file's own elevations,
  // a haversine (spherical) length, and the file's SHA-256. The app uses ellipsoidal distance, so lengths agree to about 0.1%.
  const facts = {
    "bell-buckle": { file: "bell_buckle.gpx", points: 1172, haversine: 4986.9, min: 259.4, max: 278, start: 263.2, end: 268.4, sha: "3355785fb581367490833ac16227817ba8ae0d4d02ec30fecb118f85b3aa5891" },
    "jesse-owens-park": { file: "jessie_owens_park.gpx", points: 1215, haversine: 4077.7, min: 195.8, max: 224, start: 199, end: 199.4, sha: "478c2fe5a26b05cb37cf99c5879d1d811888d74762bf6f0987d8fc40d03aa260" },
    "kentucky-run-for-gold": { file: "ketucky_run_for_gold.gpx", points: 1236, haversine: 5073.8, min: 197.2, max: 237.6, start: 212.2, end: 199.6, sha: "741cb244592fffe7bb49d63f28a2e96ce2d46432cdd644e931ea735ce2fc86c2" },
    "murfreesboro-classic": { file: "murfersboro_classic.gpx", points: 1243, haversine: 5081.2, min: 161, max: 187, start: 183.8, end: 172.2, sha: "a74720f755e0135d26c60cfc80d896f250e52a815b076712a772ff839f276b69" },
    "hermitage": { file: "tn_regionals.gpx", points: 1161, haversine: 5093.8, min: 137.4, max: 158.4, start: 141.4, end: 153, sha: "7f4ccc7b389c319ff228ecabf8f326562cca9a0da1b4f07d15d8fe9230c8f74c" },
  } as const;

  describe.each(Object.entries(facts))("%s", (id, f) => {
    const course = getCourse(id)!;

    it("keeps the original GPX byte for byte, and records its fingerprint", () => {
      const original = readFileSync(join("courses", id, f.file));
      expect(createHash("sha256").update(original).digest("hex")).toBe(f.sha);
      expect(course.source.sha256).toBe(f.sha);
    });

    it("has every recorded point and the file's own elevations", () => {
      expect(course.points).toHaveLength(f.points);
      expect(course.elevation).toMatchObject({ minMeters: f.min, maxMeters: f.max, startMeters: f.start, endMeters: f.end });
    });

    it("measures the length of the track (within 0.3% of an independent spherical calculation)", () => {
      expect(Math.abs(course.distanceMeters - f.haversine) / f.haversine).toBeLessThan(0.003);
    });

    it("has no unrecorded gaps (the watch logged every second, at most one 2-second step)", () => {
      expect(course.gaps).toEqual([]);
    });
  });

  it("all but Jesse Owens Park are about a 5K (within 3%); Jesse Owens Park is 2.53 mi and will not match a 5K", () => {
    for (const id of ["bell-buckle", "kentucky-run-for-gold", "murfreesboro-classic", "hermitage", "john-hunt-park"]) {
      expect(Math.abs(getCourse(id)!.distanceMeters - 5000) / 5000).toBeLessThanOrEqual(0.03);
    }
    expect(getCourse("jesse-owens-park")!.distanceMeters).toBeLessThan(4100);
  });
});
