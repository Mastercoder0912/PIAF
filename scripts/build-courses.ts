/**
 * Builds src/courses/data/<id>.json from each folder in courses/.
 *
 *   npm run courses
 *
 * A course folder holds the ORIGINAL GPX (never edited) and a small course.json (id, name, notes).
 * Run from the project root. Requires Node 22.18+ (runs TypeScript directly) and dev dependencies (jsdom).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { buildCourse, courseProblems } from "../src/courses/build.ts";
import type { CourseMeta } from "../src/courses/types.ts";

(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM("").window.DOMParser;

const SOURCES = "courses";
const OUTPUT = join("src", "courses", "data");

/** Pretty JSON, but one line per point so the file stays readable and diffs stay small. */
export function formatCourseJson(data: unknown): string {
  return (
    JSON.stringify(data, null, 2).replace(
      /\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g,
      "[$1, $2, $3, $4]",
    ) + "\n"
  );
}

mkdirSync(OUTPUT, { recursive: true });
let built = 0;
for (const name of readdirSync(SOURCES).sort()) {
  const dir = join(SOURCES, name);
  if (!statSync(dir).isDirectory()) continue;
  const meta = JSON.parse(readFileSync(join(dir, "course.json"), "utf8")) as CourseMeta;
  if (meta.id !== name) throw new Error(`${dir}/course.json: id "${meta.id}" must match the folder name "${name}".`);
  const gpx = readFileSync(join(dir, meta.gpx));
  const sha256 = createHash("sha256").update(gpx).digest("hex");
  const data = buildCourse(meta, gpx.toString("utf8"), sha256);
  const problems = courseProblems(data);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join(" ")}`);
  writeFileSync(join(OUTPUT, `${meta.id}.json`), formatCourseJson(data));
  console.log(`${meta.id}: ${data.points.length} points, ${data.distanceMeters} m, gain ${data.elevation.gainMeters} m, ${data.gaps.length} gap(s)`);
  built++;
}
if (built === 0) throw new Error(`No course folders found in ${SOURCES}/.`);
