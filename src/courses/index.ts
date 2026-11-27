import bellBuckle from "./data/bell-buckle.json";
import hermitage from "./data/hermitage.json";
import jesseOwensPark from "./data/jesse-owens-park.json";
import johnHuntPark from "./data/john-hunt-park.json";
import kentuckyRunForGold from "./data/kentucky-run-for-gold.json";
import murfreesboroClassic from "./data/murfreesboro-classic.json";
import type { CourseData } from "./types";

/**
 * Every course the app knows. To add one: put its folder in courses/, run `npm run courses`,
 * then import the generated JSON here and add it to the list (see courses/README.md).
 * tests/courses/data.test.ts checks every course in this list.
 */
export const COURSES: readonly CourseData[] = [
  johnHuntPark,
  bellBuckle,
  hermitage,
  jesseOwensPark,
  kentuckyRunForGold,
  murfreesboroClassic,
] as unknown as readonly CourseData[];

export function getCourse(id: string, courses: readonly CourseData[] = COURSES): CourseData | undefined {
  return courses.find((course) => course.id === id);
}
