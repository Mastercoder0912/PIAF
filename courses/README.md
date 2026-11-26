# Courses

Each course is a folder here:

```
courses/<id>/
  <recording>.gpx    the ORIGINAL export, never edited
  course.json        id (= folder name), name, place, summary, notes, and the GPX file name
```

`npm run courses` reads every folder, checks the GPX (valid coordinates, an elevation on every point), and writes
`src/courses/data/<id>.json`, which the app imports. Commit both the GPX and the generated JSON. A test rebuilds each
course from its GPX and fails if the committed JSON differs, so the data can't drift from its source.

## Adding a course

1. Export a GPX **track** from Garmin Connect (Activity → ⚙ → Export to GPX) or any other source. It needs coordinates
   and an elevation on every point. Timestamps are optional; with them, pauses and GPS gaps are flagged.
2. Create `courses/<id>/`, put the GPX in it, and add a `course.json` like the existing one.
3. Run `npm run courses`.
4. Add one `import` and one entry to the list in `src/courses/index.ts`.

If a file is missing elevation, has no track points, or is not GPX, the script stops and says exactly why. It never
fills in missing values.

## What is stored

See `src/courses/types.ts`. Points are `[lat, lon, elevation m, distance m]`; distance is measured along the track on the
WGS-84 ellipsoid. Elevation gain/loss uses a 5-point moving average (see `src/courses/elevation.ts`). Coordinates are
rounded to 6 decimals (about 0.1 m), elevation and distance to 0.1 m.
