import johnHuntPark from "./data/john-hunt-park.json";
import type { CourseData } from "./types";

/**
 * Every course the app knows. To add one: put its folder in courses/, run `npm run courses`,
 * then import the generated JSON here and add it to the list (see courses/README.md).
 * tests/courses/data.test.ts checks every course in this list.
 */
export const COURSES: readonly CourseData[] = [johnHuntPark as unknown as CourseData];

export function getCourse(id: string, courses: readonly CourseData[] = COURSES): CourseData | undefined {
  return courses.find((course) => course.id === id);
}
