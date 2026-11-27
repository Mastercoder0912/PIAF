import type { CourseData } from "../../src/courses/types";
import recording from "./gap-recording.json";

/**
 * A real Garmin recording (the John Hunt Park run of October 17, 2026) that the app no longer ships, kept here only as a
 * test fixture: it is the one real track with an unrecorded gap (41 s, about 704 m to 871 m), so it exercises the
 * "nothing was recorded here" behaviour on real data. Its numbers were derived independently of the app when the tests
 * around it were written (5,033.7 m; 1,190 points; gain 76.5 m; elevation 183.0 to 206.2 m).
 */
export const GAP_RECORDING = recording as unknown as CourseData;
