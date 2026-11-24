import { describe, expect, it } from "vitest";
import {
  FINISH_LOCATION_ID,
  MAX_LOCATION_NAME_LENGTH,
  calculateRace,
  classifyLocationDistance,
  planSplitImport,
  resolvePacingLocations,
  targetTimeAtDistance,
  targetTimeAtLocation,
  toMeters,
  validateLocationDistance,
  validateLocationName,
  validatePacingLocationInput,
  validatePacingLocations,
  type PacingLocationDefinition,
  type RaceCalculation,
  type RaceConfig,
} from "../src/engine";
import { at, errorCodes, unwrap } from "./helpers";

const MILE = 1609.344;

function race(config: Partial<RaceConfig> & { totalDistanceMeters: number }): RaceCalculation {
  return unwrap(calculateRace({ intervalMode: "automatic", ...config }));
}

/** 5000 m in 1200 s: exactly 0.24 s per meter, which makes mental checks easy. */
const raceA = () => race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200 });
/** 5000 m at 7:00 per mile. */
const raceB = () => race({ totalDistanceMeters: 5000, targetPaceSecondsPerMile: 420 });

const def = (id: string, distanceMeters: number, name = `Point ${id}`): PacingLocationDefinition => ({
  id,
  name,
  distanceMeters,
});

// Expected values below were computed independently with exact rational arithmetic (Python Fractions),
// not by calling the code under test.

describe("targetTimeAtLocation: correct times at arbitrary distances", () => {
  it("5000 m in 1200 s: 0.24 s per meter everywhere", () => {
    const r = raceA();
    for (const [meters, seconds] of [[800, 192], [1200, 288], [1600, 384], [2000, 480], [3000, 720], [4000, 960]] as const) {
      expect(targetTimeAtLocation(meters, r)).toBeCloseTo(seconds, 9);
    }
  });

  it("5000 m at 420 s/mile: values off the split grid", () => {
    const r = raceB();
    expect(targetTimeAtLocation(800, r)).toBeCloseTo(208.78072059174423, 9);
    expect(targetTimeAtLocation(1200, r)).toBeCloseTo(313.1710808876163, 9);
    expect(targetTimeAtLocation(2000, r)).toBeCloseTo(521.9518014793605, 9);
    expect(targetTimeAtLocation(3000, r)).toBeCloseTo(782.9277022190408, 9);
    expect(targetTimeAtLocation(4000, r)).toBeCloseTo(1043.903602958721, 9);
  });

  it("a location at exactly one mile takes exactly one pace", () => {
    expect(targetTimeAtLocation(MILE, raceB())).toBeCloseTo(420, 12);
    expect(targetTimeAtLocation(1.5 * MILE, raceB())).toBeCloseTo(630, 12);
  });

  it("1600 m and one mile are different places with different times", () => {
    const r = race({ totalDistanceMeters: 5000, targetPaceSecondsPerMile: 360 });
    expect(targetTimeAtLocation(1600, r)).toBeCloseTo(357.9098067287044, 9);
    expect(targetTimeAtLocation(MILE, r)).toBeCloseTo(360, 12);
  });
});

describe("targetTimeAtLocation: meters, kilometers and miles", () => {
  const r = raceB();

  it("the same place gives the same time in any unit", () => {
    const viaMeters = targetTimeAtLocation(toMeters(2000, "m"), r);
    const viaKm = targetTimeAtLocation(toMeters(2, "km"), r);
    expect(viaKm).toBe(viaMeters);
    expect(viaMeters).toBeCloseTo(521.9518014793605, 9);
  });

  it("miles use the exact 1609.344 m statute mile", () => {
    expect(targetTimeAtLocation(toMeters(1, "mi"), r)).toBeCloseTo(420, 12);
    const tenK = race({ totalDistanceMeters: 10000, targetPaceSecondsPerMile: 360 });
    expect(targetTimeAtLocation(toMeters(2, "mi"), tenK)).toBeCloseTo(720, 12);
    expect(targetTimeAtLocation(toMeters(3.1, "mi"), tenK)).toBeCloseTo(1116, 9);
    expect(targetTimeAtLocation(toMeters(1, "km"), tenK)).toBeCloseTo(223.69362920544023, 9);
    expect(targetTimeAtLocation(toMeters(5, "km"), tenK)).toBeCloseTo(1118.468146027201, 9);
  });

  it("a kilometer location that equals a whole mile lands on the mile time", () => {
    expect(targetTimeAtLocation(toMeters(1.609344, "km"), r)).toBeCloseTo(420, 9);
  });
});

describe("targetTimeAtLocation: the finish is exact", () => {
  it("returns the race's exact total time, bit for bit, for time goals and pace goals", () => {
    const races = [
      raceA(),
      raceB(),
      race({ totalDistanceMeters: 10000, targetTimeSeconds: 2400 }),
      race({ totalDistanceMeters: 42195, targetTimeSeconds: 10800 }),
      race({ totalDistanceMeters: 1609.344, targetPaceSecondsPerMile: 359.9 }),
      race({ totalDistanceMeters: 21097.5, targetPaceSecondsPerMile: 411.3333 }),
      race({ totalDistanceMeters: 3, targetTimeSeconds: 0.7 }),
    ];
    for (const r of races) {
      expect(targetTimeAtLocation(r.totalDistanceMeters, r)).toBe(r.totalTimeSeconds);
    }
  });

  it("a time goal's total is exactly what the coach typed", () => {
    expect(targetTimeAtLocation(5000, race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200 }))).toBe(1200);
  });

  it("a distance within 1 micrometer of the finish counts as the finish", () => {
    const r = raceB();
    expect(targetTimeAtLocation(5000 - 5e-7, r)).toBe(r.totalTimeSeconds);
    expect(targetTimeAtLocation(5000 + 5e-7, r)).toBe(r.totalTimeSeconds);
  });

  it("a location 1 mm before the finish is a real, earlier location", () => {
    const r = raceB();
    const t = targetTimeAtLocation(4999.999, r);
    expect(t).toBeLessThan(r.totalTimeSeconds);
    expect(r.totalTimeSeconds - t).toBeCloseTo(0.001 * 420 / MILE, 9);
  });
});

describe("targetTimeAtLocation: agrees with the split table", () => {
  it("every non-finish split time is reproduced exactly (same formula, no rounding)", () => {
    for (const r of [raceA(), raceB(), race({ totalDistanceMeters: 10000, targetPaceSecondsPerMile: 391.7 })]) {
      for (const split of r.splits) {
        expect(targetTimeAtLocation(split.distanceMeters, r)).toBe(split.targetTimeSeconds);
      }
    }
  });
});

describe("targetTimeAtLocation: invalid distances", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5000.001, 6000])("throws RangeError for %s", (distance) => {
    expect(() => targetTimeAtLocation(distance, raceB())).toThrow(RangeError);
  });
});

describe("no cumulative rounding error", () => {
  it("999 locations 5 m apart are each correct on their own, strictly increasing, and end before the finish", () => {
    const r = raceA();
    const definitions = Array.from({ length: 999 }, (_, i) => def(`l${i}`, (i + 1) * 5));
    const { locations, finish } = resolvePacingLocations(definitions, r);
    expect(locations).toHaveLength(999);
    locations.forEach((location, i) => {
      // Independent expectation: this race is exactly 0.24 s per meter.
      expect(Math.abs(location.targetTimeSeconds - location.distanceMeters * 0.24)).toBeLessThan(1e-9);
      if (i > 0) expect(location.targetTimeSeconds).toBeGreaterThan(at(locations, i - 1).targetTimeSeconds);
    });
    expect(at(locations, -1).targetTimeSeconds).toBeLessThan(finish.targetTimeSeconds);
    expect(finish.targetTimeSeconds).toBe(1200);
  });

  it("a location's time does not depend on which other locations exist or the order they were added", () => {
    const r = raceB();
    const alone = resolvePacingLocations([def("x", 3000)], r).locations[0]?.targetTimeSeconds;
    const crowd = [def("a", 100), def("x", 3000), def("b", 2999.5), def("c", 4500)];
    const withOthers = resolvePacingLocations(crowd, r).locations.find((l) => l.id === "x")?.targetTimeSeconds;
    const reversed = resolvePacingLocations([...crowd].reverse(), r).locations.find((l) => l.id === "x")?.targetTimeSeconds;
    expect(withOthers).toBe(alone);
    expect(reversed).toBe(alone);
  });

  it("resolving repeatedly gives identical numbers (display rounding never feeds back)", () => {
    const r = raceB();
    const definitions = [def("a", 800), def("b", 1234.5678), def("c", 4321.0987)];
    const first = resolvePacingLocations(definitions, r);
    const second = resolvePacingLocations(first.locations, r); // feeding resolved objects back in
    expect(second.locations.map((l) => l.targetTimeSeconds)).toEqual(first.locations.map((l) => l.targetTimeSeconds));
  });

  it("times are linear in distance to within floating-point noise", () => {
    const r = raceB();
    const t1 = targetTimeAtLocation(777, r);
    expect(targetTimeAtLocation(1554, r) / t1).toBeCloseTo(2, 12);
    expect(targetTimeAtLocation(3885, r) / t1).toBeCloseTo(5, 12);
  });
});

describe("classifyLocationDistance", () => {
  it("separates before-finish, at-finish, beyond and invalid", () => {
    expect(classifyLocationDistance(100, 5000)).toBe("before-finish");
    expect(classifyLocationDistance(5000, 5000)).toBe("at-finish");
    expect(classifyLocationDistance(5000 + 1e-9, 5000)).toBe("at-finish");
    expect(classifyLocationDistance(5000.01, 5000)).toBe("beyond-race");
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(classifyLocationDistance(bad, 5000)).toBe("invalid-distance");
    }
  });
});

describe("resolvePacingLocations: ordering and shape", () => {
  it("sorts by distance no matter the creation order", () => {
    const { locations } = resolvePacingLocations(
      [def("c", 4000), def("a", 800), def("d", 1200), def("b", 2000)],
      raceA(),
    );
    expect(locations.map((l) => l.distanceMeters)).toEqual([800, 1200, 2000, 4000]);
    expect(locations.map((l) => l.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("appends an automatic finish: reserved id, total distance, exact time", () => {
    const r = raceB();
    const { finish, locations } = resolvePacingLocations([def("a", 1000)], r);
    expect(finish).toEqual({
      id: FINISH_LOCATION_ID,
      name: "Finish",
      distanceMeters: 5000,
      targetTimeSeconds: r.totalTimeSeconds,
      isFinish: true,
    });
    expect(locations.every((l) => l.isFinish === false)).toBe(true);
    expect(locations.some((l) => l.id === FINISH_LOCATION_ID)).toBe(false);
  });

  it("a race with no stored locations still has its finish", () => {
    const { locations, finish, outOfRange } = resolvePacingLocations([], raceA());
    expect(locations).toEqual([]);
    expect(outOfRange).toEqual([]);
    expect(finish.targetTimeSeconds).toBe(1200);
  });

  it("keeps ids and any extra fields the caller attached", () => {
    const stored = [{ id: "loc-7", name: "Water", distanceMeters: 2000, unit: "km" as const }];
    const { locations } = resolvePacingLocations(stored, raceA());
    expect(at(locations, 0)).toMatchObject({ id: "loc-7", name: "Water", unit: "km", distanceMeters: 2000 });
  });

  it("does not modify its input", () => {
    const input = Object.freeze([Object.freeze(def("b", 3000)), Object.freeze(def("a", 1000))]);
    expect(() => resolvePacingLocations(input, raceA())).not.toThrow();
    expect(input.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("the resolved list always passes the Phase 1 pacing-location validator", () => {
    const r = raceB();
    const { locations, finish } = resolvePacingLocations(
      [def("a", 800), def("b", 1200), def("c", 2000), def("d", 3000), def("e", 4000)],
      r,
    );
    const all = [...locations, finish];
    expect(validatePacingLocations(all, r.totalDistanceMeters).ok).toBe(true);
    expect(all.at(-1)?.isFinish).toBe(true);
  });
});

describe("resolvePacingLocations: stays consistent when the race changes", () => {
  const stored = [def("a", 800), def("b", 2000), def("c", 4000)];

  it("a different target changes every time but not ids or distances", () => {
    const fast = resolvePacingLocations(stored, race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200 }));
    const slow = resolvePacingLocations(stored, race({ totalDistanceMeters: 5000, targetTimeSeconds: 1500 }));
    expect(slow.locations.map((l) => l.id)).toEqual(fast.locations.map((l) => l.id));
    expect(slow.locations.map((l) => l.distanceMeters)).toEqual(fast.locations.map((l) => l.distanceMeters));
    slow.locations.forEach((l, i) => {
      expect(l.targetTimeSeconds / at(fast.locations, i).targetTimeSeconds).toBeCloseTo(1.25, 12);
    });
    expect(slow.finish.targetTimeSeconds).toBe(1500);
  });

  it("a shorter race moves locations past the new finish into outOfRange, with no target time", () => {
    const { locations, outOfRange, finish } = resolvePacingLocations(
      stored,
      race({ totalDistanceMeters: 3000, targetTimeSeconds: 720 }),
    );
    expect(locations.map((l) => l.id)).toEqual(["a", "b"]);
    expect(outOfRange).toHaveLength(1);
    expect(at(outOfRange, 0).reason).toBe("beyond-race");
    expect(at(outOfRange, 0).location.id).toBe("c");
    expect("targetTimeSeconds" in at(outOfRange, 0).location).toBe(false);
    expect(finish.distanceMeters).toBe(3000);
  });

  it("a location that now sits exactly on the finish is flagged, not duplicated", () => {
    const { locations, outOfRange, finish } = resolvePacingLocations(
      stored,
      race({ totalDistanceMeters: 2000, targetTimeSeconds: 480 }),
    );
    expect(locations.map((l) => l.id)).toEqual(["a"]);
    expect(at(outOfRange, 0).reason).toBe("at-finish");
    expect(finish.distanceMeters).toBe(2000);
  });

  it("lists out-of-range locations in distance order", () => {
    const { outOfRange } = resolvePacingLocations(
      [def("z", 4500), def("y", 3500), def("x", 100)],
      race({ totalDistanceMeters: 3000, targetTimeSeconds: 700 }),
    );
    expect(outOfRange.map((o) => o.location.id)).toEqual(["y", "z"]);
  });

  it("corrupt distances become 'invalid-distance' instead of crashing", () => {
    const { outOfRange } = resolvePacingLocations([def("a", 0), def("b", Number.NaN)], raceA());
    expect(outOfRange.map((o) => o.reason)).toEqual(["invalid-distance", "invalid-distance"]);
  });
});

describe("validateLocationName", () => {
  it.each([["empty", ""], ["spaces only", "   \t "], ["undefined", undefined], ["a number", 5], ["null", null]])(
    "rejects %s",
    (_label, value) => {
      const result = validateLocationName(value);
      expect(errorCodes(result)).toEqual(["INVALID_NAME"]);
      if (!result.ok) {
        expect(at(result.errors, 0).field).toBe("name");
        expect(at(result.errors, 0).message).toBe("Enter a name for this location.");
      }
    },
  );

  it("trims surrounding whitespace", () => {
    expect(unwrap(validateLocationName("  Water stop  "))).toBe("Water stop");
  });

  it("allows exactly the maximum length and rejects one more, with the count in the message", () => {
    expect(validateLocationName("x".repeat(MAX_LOCATION_NAME_LENGTH)).ok).toBe(true);
    const tooLong = validateLocationName("x".repeat(MAX_LOCATION_NAME_LENGTH + 1));
    expect(errorCodes(tooLong)).toEqual(["INVALID_NAME"]);
    if (!tooLong.ok) expect(at(tooLong.errors, 0).message).toContain(`${MAX_LOCATION_NAME_LENGTH + 1}`);
  });

  it("counts an emoji as one character", () => {
    expect(validateLocationName("🏃".repeat(MAX_LOCATION_NAME_LENGTH)).ok).toBe(true);
  });
});

describe("validateLocationDistance", () => {
  const ctx = (existing: PacingLocationDefinition[] = [], editingId?: string) => ({
    race: raceB(),
    existing,
    ...(editingId ? { editingId } : {}),
  });

  it("accepts a distance inside the race, on or off the split grid", () => {
    for (const d of [0.5, 1, 333.3, 1600, MILE, 4999.999]) {
      expect(validateLocationDistance(d, ctx()).ok).toBe(true);
    }
  });

  it.each([0, -1, -5000, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s as not a positive number", (d) => {
    const result = validateLocationDistance(d, ctx());
    expect(errorCodes(result)).toEqual(["INVALID_DISTANCE"]);
    if (!result.ok) expect(at(result.errors, 0).message).toBe("Distance must be a number greater than 0.");
  });

  it("rejects a distance beyond the race and says what the race length is", () => {
    const result = validateLocationDistance(5500, ctx());
    expect(errorCodes(result)).toEqual(["BEYOND_RACE_DISTANCE"]);
    if (!result.ok) {
      expect(at(result.errors, 0).message).toContain("5500 m");
      expect(at(result.errors, 0).message).toContain("5000 m");
    }
    expect(errorCodes(validateLocationDistance(5000.001, ctx()))).toEqual(["BEYOND_RACE_DISTANCE"]);
  });

  it("refuses the finish distance: it already exists automatically", () => {
    for (const d of [5000, 5000 + 5e-7, 5000 - 5e-7]) {
      const result = validateLocationDistance(d, ctx());
      expect(errorCodes(result)).toEqual(["DUPLICATE_DISTANCE"]);
      if (!result.ok) expect(at(result.errors, 0).message).toMatch(/finish line .* added automatically/);
    }
  });

  it("refuses a duplicate distance and names the location that has it", () => {
    const result = validateLocationDistance(2000, ctx([def("a", 2000, "Water stop")]));
    expect(errorCodes(result)).toEqual(["DUPLICATE_DISTANCE"]);
    if (!result.ok) expect(at(result.errors, 0).message).toContain('"Water stop"');
  });

  it("treats distances within 1 micrometer as the same place", () => {
    expect(errorCodes(validateLocationDistance(2000 + 1e-9, ctx([def("a", 2000)])))).toEqual(["DUPLICATE_DISTANCE"]);
    expect(validateLocationDistance(2000.001, ctx([def("a", 2000)])).ok).toBe(true);
  });

  it("does not treat 1600 m and one mile as duplicates", () => {
    expect(validateLocationDistance(MILE, ctx([def("a", 1600)])).ok).toBe(true);
    expect(validateLocationDistance(1600, ctx([def("a", MILE)])).ok).toBe(true);
  });

  it("when editing, a location may keep its own distance but not take another's", () => {
    const existing = [def("a", 2000), def("b", 3000)];
    expect(validateLocationDistance(2000, ctx(existing, "a")).ok).toBe(true);
    expect(errorCodes(validateLocationDistance(3000, ctx(existing, "a")))).toEqual(["DUPLICATE_DISTANCE"]);
  });
});

describe("validatePacingLocationInput", () => {
  const context = { race: raceB(), existing: [def("a", 1000)] };

  it("returns the trimmed name and the distance when everything is valid", () => {
    const value = unwrap(validatePacingLocationInput({ name: "  Mile mark ", distanceMeters: MILE }, context));
    expect(value).toEqual({ name: "Mile mark", distanceMeters: MILE });
  });

  it("reports a name error and a distance error together, each on its own field", () => {
    const result = validatePacingLocationInput({ name: "", distanceMeters: 9999 }, context);
    expect(errorCodes(result).sort()).toEqual(["BEYOND_RACE_DISTANCE", "INVALID_NAME"]);
    if (!result.ok) expect(result.errors.map((e) => e.field).sort()).toEqual(["distance", "name"]);
  });

  it("an invalid location is never returned as valid", () => {
    for (const input of [
      { name: "", distanceMeters: 100 },
      { name: "A", distanceMeters: 0 },
      { name: "A", distanceMeters: -3 },
      { name: "A", distanceMeters: 5001 },
      { name: "A", distanceMeters: 5000 },
      { name: "A", distanceMeters: 1000 },
    ]) {
      expect(validatePacingLocationInput(input, context).ok).toBe(false);
    }
  });
});

describe("planSplitImport", () => {
  it("5K automatic: every split except the finish becomes a location, named from its label", () => {
    const r = raceA();
    const plan = planSplitImport(r.splits, [], r);
    // automatic splits for a 5K are whole-mile markers plus the finish
    expect(plan.toAdd.map((p) => p.name)).toEqual(["1 mile", "2 miles", "3 miles"]);
    expect(plan.toAdd).toHaveLength(r.splits.length - 1);
    expect(plan.skippedFinish).toBe(1);
    expect(plan.skippedExisting).toBe(0);
  });

  it("uses each split's exact distance (the mile is 1609.344 m, not 1600 m)", () => {
    const r = raceA();
    const distances = planSplitImport(r.splits, [], r).toAdd.map((p) => p.distanceMeters);
    expect(distances).toHaveLength(3);
    [1609.344, 3218.688, 4828.032].forEach((meters, i) => expect(at(distances, i)).toBeCloseTo(meters, 9));
    expect(distances).not.toContain(1600);
  });

  it("a manual location at 1600 m does not count as the 1-mile split (they are different places)", () => {
    const r = raceA();
    const plan = planSplitImport(r.splits, [def("m", 1600, "Metric mile")], r);
    expect(plan.toAdd.map((p) => p.name)).toEqual(["1 mile", "2 miles", "3 miles"]);
    expect(plan.skippedExisting).toBe(0);
  });

  it("never includes the finish, whether flagged or matched by distance", () => {
    const r = raceB();
    const plan = planSplitImport(r.splits, [], r);
    expect(plan.toAdd.some((p) => p.distanceMeters === 5000)).toBe(false);
    const unflagged = r.splits.map((s) => ({ ...s, isFinish: false }));
    const plan2 = planSplitImport(unflagged, [], r);
    expect(plan2.toAdd.some((p) => p.distanceMeters === 5000)).toBe(false);
    expect(plan2.skippedFinish).toBe(1);
  });

  it("a race that is exactly one mile: its 400 m splits are imported, and the mile is the finish", () => {
    const r = race({ totalDistanceMeters: MILE, targetPaceSecondsPerMile: 360 });
    const plan = planSplitImport(r.splits, [], r);
    expect(plan.toAdd.map((p) => p.distanceMeters)).toEqual([400, 800, 1200]);
    expect(plan.skippedFinish).toBe(1);
  });

  it("a race shorter than a mile imports its 200 m splits", () => {
    const r = race({ totalDistanceMeters: 800, targetTimeSeconds: 120 });
    const plan = planSplitImport(r.splits, [], r);
    expect(plan.toAdd.map((p) => p.distanceMeters)).toEqual([200, 400, 600]);
    expect(plan.skippedFinish).toBe(1);
  });

  it("is idempotent: importing again after adding everything plans nothing", () => {
    const r = raceA();
    const first = planSplitImport(r.splits, [], r);
    const stored = first.toAdd.map((p, i) => def(`loc-${i}`, p.distanceMeters, p.name));
    const second = planSplitImport(r.splits, stored, r);
    expect(second.toAdd).toEqual([]);
    expect(second.skippedExisting).toBe(first.toAdd.length);
  });

  it("skips distances that already have a location, but plans the rest", () => {
    const r = raceA();
    const existing = [def("m1", 3218.688, "Hill"), def("m2", 1300, "Turn")];
    const plan = planSplitImport(r.splits, existing, r);
    expect(plan.skippedExisting).toBe(1); // the 2-mile marker, 3218.688 m
    expect(plan.toAdd.map((p) => p.name)).toEqual(["1 mile", "3 miles"]);
  });

  it("does not require an exact match: a manual location within 1 micrometer counts as present", () => {
    const r = raceA();
    const plan = planSplitImport(r.splits, [def("m", MILE + 1e-9, "Mile")], r);
    expect(plan.toAdd.some((p) => p.name === "1 mile")).toBe(false);
    expect(plan.skippedExisting).toBe(1);
  });

  it("a manual location NEAR a split (1 m away) does not block it", () => {
    const r = raceA();
    const plan = planSplitImport(r.splits, [def("m", MILE + 1, "Close")], r);
    expect(plan.toAdd.some((p) => p.name === "1 mile")).toBe(true);
  });

  it("works with manual intervals", () => {
    const r = race({
      totalDistanceMeters: 5000,
      targetTimeSeconds: 1200,
      intervalMode: "manual",
      intervalDistanceMeters: 1000,
    });
    const plan = planSplitImport(r.splits, [], r);
    expect(plan.toAdd.map((p) => p.name)).toEqual(["1000 m", "2000 m", "3000 m", "4000 m"]);
    expect(plan.skippedFinish).toBe(1);
  });

  it("a race shorter than the first interval has only the finish: nothing to import", () => {
    const r = race({ totalDistanceMeters: 150, targetTimeSeconds: 30 });
    const plan = planSplitImport(r.splits, [], r);
    expect(plan.toAdd).toEqual([]);
    expect(plan.skippedFinish).toBe(1);
  });

  it("imported locations get exactly the split table's times once resolved", () => {
    for (const r of [raceA(), raceB(), race({ totalDistanceMeters: 10000, targetPaceSecondsPerMile: 391.7 })]) {
      const plan = planSplitImport(r.splits, [], r);
      const stored = plan.toAdd.map((p, i) => def(`loc-${i}`, p.distanceMeters, p.name));
      const { locations, finish } = resolvePacingLocations(stored, r);
      expect(locations).toHaveLength(r.splits.length - 1);
      locations.forEach((location, i) => {
        expect(location.targetTimeSeconds).toBe(at(r.splits, i).targetTimeSeconds);
        expect(location.distanceMeters).toBe(at(r.splits, i).distanceMeters);
      });
      expect(finish.targetTimeSeconds).toBe(at(r.splits, -1).targetTimeSeconds);
    }
  });

  it("does not modify the splits or existing locations it is given", () => {
    const r = raceA();
    const splits = Object.freeze(r.splits.map((s) => Object.freeze({ ...s })));
    const existing = Object.freeze([Object.freeze(def("m", 1200))]);
    expect(() => planSplitImport(splits, existing, r)).not.toThrow();
  });
});
