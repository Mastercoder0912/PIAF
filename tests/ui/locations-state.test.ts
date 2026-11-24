import { describe, expect, it } from "vitest";
import {
  FINISH_LOCATION_ID,
  calculateRace,
  resolvePacingLocations,
  type RaceCalculation,
  type RaceConfig,
} from "../../src/engine";
import { formatDistanceInUnit, formatMeters } from "../../src/display";
import {
  FINISH_PROTECTED_MESSAGE,
  INITIAL_LOCATIONS,
  NOT_FOUND_MESSAGE,
  NO_RACE_MESSAGE,
  addLocation,
  clearLocations,
  importSplits,
  locationToFormValues,
  naturalUnitFor,
  removeLocation,
  undoDelete,
  updateLocation,
  type LocationErrors,
  type LocationFormValues,
  type LocationsState,
} from "../../src/state/locations";
import { at, unwrap } from "../helpers";

const MILE = 1609.344;

function race(config: Partial<RaceConfig> & { totalDistanceMeters: number }): RaceCalculation {
  return unwrap(calculateRace({ intervalMode: "automatic", ...config }));
}
const raceA = () => race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200 }); // 0.24 s/m
const raceB = () => race({ totalDistanceMeters: 5000, targetPaceSecondsPerMile: 420 });

const form = (name: string, distanceText: string, unit: LocationFormValues["unit"] = "m"): LocationFormValues => ({
  name,
  distanceText,
  unit,
});

/** Add or fail the test, returning the new state. */
function added(state: LocationsState, values: LocationFormValues, r: RaceCalculation | null = raceA()) {
  const outcome = addLocation(state, values, r);
  if (!outcome.ok) throw new Error(`add failed: ${JSON.stringify(outcome.errors)}`);
  return outcome;
}

function errorsOf(outcome: { ok: boolean; errors?: LocationErrors }): LocationErrors {
  if (outcome.ok || !outcome.errors) throw new Error("Expected errors");
  return outcome.errors;
}

/** Seed a state with several locations through the real add function. */
function seeded(entries: Array<[string, string, LocationFormValues["unit"]?]>, r = raceA()): LocationsState {
  return entries.reduce((state, [name, text, unit]) => added(state, form(name, text, unit ?? "m"), r).state, INITIAL_LOCATIONS);
}

const times = (state: LocationsState, r = raceA()) =>
  resolvePacingLocations(state.items, r).locations.map((l) => [l.name, l.distanceMeters, l.targetTimeSeconds] as const);

describe("creating a location", () => {
  it("stores the trimmed name, the distance in meters, the unit, and a stable id", () => {
    const outcome = added(INITIAL_LOCATIONS, form("  Water stop ", "1200"));
    expect(outcome.id).toBe("loc-1");
    expect(outcome.state.items).toEqual([{ id: "loc-1", name: "Water stop", distanceMeters: 1200, unit: "m" }]);
  });

  it("converts kilometers and miles to meters (exact statute mile)", () => {
    const km = added(INITIAL_LOCATIONS, form("A", "1.2", "km")).state.items[0];
    expect(km?.distanceMeters).toBe(1200);
    expect(km?.unit).toBe("km");
    const mi = added(INITIAL_LOCATIONS, form("B", "2", "mi")).state.items[0];
    expect(mi?.distanceMeters).toBeCloseTo(3218.688, 9);
    expect(mi?.unit).toBe("mi");
  });

  it("does not store a target time (it is always derived)", () => {
    const stored = added(INITIAL_LOCATIONS, form("A", "1200")).state.items[0];
    expect(stored && "targetTimeSeconds" in stored).toBe(false);
  });

  it("derives the target time from the race: 1200 m in a 5K in 20:00 is 288 s", () => {
    const state = added(INITIAL_LOCATIONS, form("A", "1200")).state;
    expect(at(times(state), 0)[2]).toBeCloseTo(288, 9);
  });

  it("does not modify the previous state", () => {
    const before = Object.freeze({ ...INITIAL_LOCATIONS, items: Object.freeze([]) });
    expect(() => addLocation(before, form("A", "100"), raceA())).not.toThrow();
    expect(before.items).toHaveLength(0);
  });

  it("allows any distance, not just split-table distances", () => {
    const state = seeded([["odd", "1234.5"], ["tiny", "3"], ["mile-ish", "1.6", "km"]]);
    expect(state.items.map((i) => i.distanceMeters)).toEqual([1234.5, 3, 1600]);
  });

  it("allows two locations with the same NAME at different distances", () => {
    expect(seeded([["Aid", "1000"], ["Aid", "2000"]]).items).toHaveLength(2);
  });
});

describe("sorting by distance", () => {
  it("lists locations in ascending distance order whatever order they were created in", () => {
    const state = seeded([["four", "4000"], ["one", "800"], ["three", "2000"], ["two", "1200"]]);
    expect(state.items.map((i) => i.name)).toEqual(["four", "one", "three", "two"]); // creation order kept in storage
    expect(times(state).map(([name]) => name)).toEqual(["one", "two", "three", "four"]); // display order
  });

  it("the finish always comes last", () => {
    const { locations, finish } = resolvePacingLocations(seeded([["a", "4999"], ["b", "10"]]).items, raceA());
    expect(at(locations, -1).distanceMeters).toBeLessThan(finish.distanceMeters);
  });

  it("mixed units sort by real distance", () => {
    const state = seeded([["mile", "1", "mi"], ["1500", "1500"], ["2k", "2", "km"], ["half", "0.5", "mi"]]);
    expect(times(state).map(([name]) => name)).toEqual(["half", "1500", "mile", "2k"]);
  });
});

describe("editing a location", () => {
  it("keeps the id, and updates name, distance and unit", () => {
    const state = seeded([["Water", "1200"]]);
    const outcome = updateLocation(state, "loc-1", form("Aid station", "2", "km"), raceA());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.id).toBe("loc-1");
    expect(outcome.state.items).toEqual([{ id: "loc-1", name: "Aid station", distanceMeters: 2000, unit: "km" }]);
  });

  it("recalculates the target time when the distance changes", () => {
    const state = seeded([["Water", "1200"]]);
    expect(at(times(state), 0)[2]).toBeCloseTo(288, 9);
    const edited = unwrap2(updateLocation(state, "loc-1", form("Water", "3000"), raceA()));
    expect(at(times(edited), 0)[2]).toBeCloseTo(720, 9);
  });

  it("re-sorts when the distance changes, without changing anyone's id", () => {
    const state = seeded([["a", "1000"], ["b", "2000"], ["c", "3000"]]);
    const edited = unwrap2(updateLocation(state, "loc-1", form("a", "4000"), raceA()));
    const resolved = resolvePacingLocations(edited.items, raceA()).locations;
    expect(resolved.map((l) => l.name)).toEqual(["b", "c", "a"]);
    expect(resolved.map((l) => l.id)).toEqual(["loc-2", "loc-3", "loc-1"]);
  });

  it("other locations are untouched by an edit", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    const edited = unwrap2(updateLocation(state, "loc-1", form("a2", "1500"), raceA()));
    expect(edited.items[1]).toBe(state.items[1]);
  });

  it("a location may be saved again at its own distance", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    expect(updateLocation(state, "loc-1", form("renamed", "1000"), raceA()).ok).toBe(true);
  });

  it("changing only the unit keeps the same place when the numbers agree", () => {
    const state = seeded([["a", "1000"]]);
    const edited = unwrap2(updateLocation(state, "loc-1", form("a", "1", "km"), raceA()));
    expect(at(edited.items, 0).distanceMeters).toBe(1000);
    expect(at(edited.items, 0).unit).toBe("km");
  });

  it("a failed edit leaves the state exactly as it was", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    const outcome = updateLocation(state, "loc-1", form("a", "2000"), raceA());
    expect(outcome.ok).toBe(false);
    expect(state.items.map((i) => i.distanceMeters)).toEqual([1000, 2000]);
  });

  it("editing an unknown id reports it", () => {
    expect(errorsOf(updateLocation(INITIAL_LOCATIONS, "loc-99", form("a", "1"), raceA())).general).toEqual([
      NOT_FOUND_MESSAGE,
    ]);
  });
});

function unwrap2(outcome: ReturnType<typeof updateLocation>): LocationsState {
  if (!outcome.ok) throw new Error(`update failed: ${JSON.stringify(outcome.errors)}`);
  return outcome.state;
}

describe("deleting and undoing", () => {
  it("removes only the chosen location", () => {
    const state = seeded([["a", "1000"], ["b", "2000"], ["c", "3000"]]);
    const outcome = removeLocation(state, "loc-2");
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.state.items.map((i) => i.id)).toEqual(["loc-1", "loc-3"]);
  });

  it("remembers the deleted location, and undo restores it with the SAME id and details", () => {
    const state = seeded([["a", "1000"], ["b", "2", "km"]]);
    const removed = removeLocation(state, "loc-2");
    if (!removed.ok) throw new Error("expected ok");
    expect(removed.state.lastDeleted).toEqual({ id: "loc-2", name: "b", distanceMeters: 2000, unit: "km" });
    const restored = undoDelete(removed.state);
    expect(restored.items.find((i) => i.id === "loc-2")).toEqual({ id: "loc-2", name: "b", distanceMeters: 2000, unit: "km" });
    expect(restored.lastDeleted).toBeNull();
    expect(times(restored).map(([n]) => n)).toEqual(["a", "b"]);
  });

  it("undo with nothing to undo changes nothing", () => {
    expect(undoDelete(INITIAL_LOCATIONS)).toBe(INITIAL_LOCATIONS);
  });

  it("only the latest delete can be undone", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    const first = removeLocation(state, "loc-1");
    if (!first.ok) throw new Error();
    const second = removeLocation(first.state, "loc-2");
    if (!second.ok) throw new Error();
    expect(second.state.lastDeleted?.id).toBe("loc-2");
    expect(undoDelete(second.state).items.map((i) => i.id)).toEqual(["loc-2"]);
  });

  it("adding, editing or importing after a delete discards the undo slot, so undo can never collide", () => {
    const state = seeded([["a", "1000"]]);
    const removed = removeLocation(state, "loc-1");
    if (!removed.ok) throw new Error();
    const readded = added(removed.state, form("new", "1000"));
    expect(readded.state.lastDeleted).toBeNull();
    const imported = importSplits(removed.state, raceA());
    if (!imported.ok) throw new Error();
    expect(imported.state.lastDeleted).toBeNull();
  });

  it("deleting an unknown id reports it", () => {
    expect(errorsOf(removeLocation(INITIAL_LOCATIONS, "nope")).general).toEqual([NOT_FOUND_MESSAGE]);
  });
});

describe("stable IDs", () => {
  it("each new location gets the next id, regardless of its distance or position", () => {
    const state = seeded([["far", "4000"], ["near", "100"], ["mid", "2000"]]);
    expect(state.items.map((i) => [i.name, i.id])).toEqual([["far", "loc-1"], ["near", "loc-2"], ["mid", "loc-3"]]);
  });

  it("an id keeps pointing at the same location after other locations are added, edited or removed", () => {
    let state = seeded([["a", "1000"], ["b", "2000"], ["c", "3000"]]);
    state = added(state, form("d", "500")).state; // sorts before everything
    state = unwrap2(updateLocation(state, "loc-1", form("a", "3500"), raceA())); // moves to the end
    const removed = removeLocation(state, "loc-2");
    if (!removed.ok) throw new Error();
    const byId = Object.fromEntries(removed.state.items.map((i) => [i.id, i.name]));
    expect(byId).toEqual({ "loc-1": "a", "loc-3": "c", "loc-4": "d" });
  });

  it("an id is never reused after a delete", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    const removed = removeLocation(state, "loc-2");
    if (!removed.ok) throw new Error();
    expect(added(removed.state, form("c", "3000")).id).toBe("loc-3");
  });

  it("an id is never reused after clearing everything", () => {
    const cleared = clearLocations(seeded([["a", "1000"], ["b", "2000"]]));
    expect(cleared.items).toEqual([]);
    expect(added(cleared, form("c", "3000")).id).toBe("loc-3");
  });

  it("ids are unique, including after an import", () => {
    let state = seeded([["a", "1000"]]);
    const imported = importSplits(state, raceA());
    if (!imported.ok) throw new Error();
    state = imported.state;
    const ids = state.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(FINISH_LOCATION_ID);
  });

  it("the resolved list keeps each location's id", () => {
    const state = seeded([["a", "4000"], ["b", "1000"]]);
    expect(resolvePacingLocations(state.items, raceA()).locations.map((l) => l.id)).toEqual(["loc-2", "loc-1"]);
  });
});

describe("validation", () => {
  const base = seeded([["Existing", "2000"]]);

  it.each([["empty", ""], ["spaces", "    "]])("rejects an %s name and keeps the state unchanged", (_label, name) => {
    const outcome = addLocation(base, form(name, "1000"), raceA());
    expect(errorsOf(outcome).name).toEqual(["Enter a name for this location."]);
    expect(errorsOf(outcome).distance).toBeUndefined();
  });

  it.each([["zero", "0"], ["negative", "-100"]])("rejects a %s distance", (_label, text) => {
    expect(errorsOf(addLocation(base, form("A", text), raceA())).distance).toEqual([
      "Distance must be a number greater than 0.",
    ]);
  });

  it.each([["blank", ""], ["letters", "abc"], ["comma decimal", "1,5"], ["two dots", "1.2.3"], ["exponent", "1e3"]])(
    "rejects %s distance text",
    (_label, text) => {
      expect(errorsOf(addLocation(base, form("A", text), raceA())).distance).toHaveLength(1);
    },
  );

  it("rejects a distance beyond the race, naming both distances", () => {
    const message = errorsOf(addLocation(base, form("A", "5500"), raceA())).distance?.[0] ?? "";
    expect(message).toContain("5500 m");
    expect(message).toContain("5000 m");
    expect(errorsOf(addLocation(base, form("A", "6", "km"), raceA())).distance?.[0]).toMatch(/beyond/);
  });

  it("rejects a duplicate distance, even entered in another unit", () => {
    const message = errorsOf(addLocation(base, form("Other", "2", "km"), raceA())).distance?.[0] ?? "";
    expect(message).toContain('"Existing"');
    expect(message).toContain("2000 m");
  });

  it("rejects a location at the finish: the finish already exists automatically", () => {
    for (const [text, unit] of [["5000", "m"], ["5", "km"]] as const) {
      expect(errorsOf(addLocation(base, form("End", text, unit), raceA())).distance?.[0]).toMatch(/finish line/);
    }
    const threeMiles = race({ totalDistanceMeters: 3 * MILE, targetPaceSecondsPerMile: 400 });
    expect(errorsOf(addLocation(INITIAL_LOCATIONS, form("End", "3", "mi"), threeMiles)).distance?.[0]).toMatch(/finish line/);
  });

  it("reports the name error and the distance error together", () => {
    const errors = errorsOf(addLocation(base, form("", "9999"), raceA()));
    expect(errors.name).toBeDefined();
    expect(errors.distance).toBeDefined();
  });

  it("reports a bad name even when the distance text can't be read", () => {
    const errors = errorsOf(addLocation(base, form("", "abc"), raceA()));
    expect(errors.name).toHaveLength(1);
    expect(errors.distance).toHaveLength(1);
  });

  it("a rejected location is never stored", () => {
    const outcome = addLocation(base, form("", "0"), raceA());
    expect(outcome.ok).toBe(false);
    expect(base.items).toHaveLength(1);
  });

  it("explains that a race must be calculated first when there is none", () => {
    expect(errorsOf(addLocation(INITIAL_LOCATIONS, form("A", "1000"), null)).general).toEqual([NO_RACE_MESSAGE]);
    expect(errorsOf(updateLocation(base, "loc-1", form("A", "1000"), null)).general).toEqual([NO_RACE_MESSAGE]);
    expect(errorsOf(importSplits(INITIAL_LOCATIONS, null)).general).toEqual([NO_RACE_MESSAGE]);
  });

  it("every message is plain English", () => {
    const errors = errorsOf(addLocation(base, form("", "-1"), raceA()));
    for (const messages of Object.values(errors)) {
      for (const message of messages ?? []) expect(message).not.toMatch(/undefined|NaN|\[object|null/);
    }
  });
});

describe("the finish location is protected", () => {
  it("cannot be edited", () => {
    const outcome = updateLocation(INITIAL_LOCATIONS, FINISH_LOCATION_ID, form("Renamed", "100"), raceA());
    expect(errorsOf(outcome).general).toEqual([FINISH_PROTECTED_MESSAGE]);
  });

  it("cannot be deleted", () => {
    const state = seeded([["a", "1000"]]);
    const outcome = removeLocation(state, FINISH_LOCATION_ID);
    expect(errorsOf(outcome).general).toEqual([FINISH_PROTECTED_MESSAGE]);
    expect(state.items).toHaveLength(1);
  });

  it("is never stored, so it can't be lost by clearing or by an import", () => {
    const imported = importSplits(INITIAL_LOCATIONS, raceA());
    if (!imported.ok) throw new Error();
    expect(imported.state.items.some((i) => i.id === FINISH_LOCATION_ID || i.distanceMeters === 5000)).toBe(false);
    expect(resolvePacingLocations(clearLocations(imported.state).items, raceA()).finish.targetTimeSeconds).toBe(1200);
  });
});

describe("importing the generated splits", () => {
  it("creates one location per split except the finish, with sensible names", () => {
    const outcome = importSplits(INITIAL_LOCATIONS, raceA());
    if (!outcome.ok) throw new Error();
    // a 5K's automatic splits are whole-mile markers plus the finish
    expect(outcome.added).toBe(3);
    expect(outcome.skippedFinish).toBe(1);
    expect(outcome.state.items.map((i) => i.name)).toEqual(["1 mile", "2 miles", "3 miles"]);
    expect(outcome.state.items.map((i) => i.id)).toEqual(["loc-1", "loc-2", "loc-3"]);
  });

  it("imported distances and times match the split table exactly", () => {
    const r = raceB();
    const outcome = importSplits(INITIAL_LOCATIONS, r);
    if (!outcome.ok) throw new Error();
    const { locations, finish } = resolvePacingLocations(outcome.state.items, r);
    locations.forEach((l, i) => {
      expect(l.distanceMeters).toBe(at(r.splits, i).distanceMeters);
      expect(l.targetTimeSeconds).toBe(at(r.splits, i).targetTimeSeconds);
    });
    expect(finish.targetTimeSeconds).toBe(at(r.splits, -1).targetTimeSeconds);
  });

  it("importing again adds nothing and says why", () => {
    const first = importSplits(INITIAL_LOCATIONS, raceA());
    if (!first.ok) throw new Error();
    const second = importSplits(first.state, raceA());
    if (!second.ok) throw new Error();
    expect(second.added).toBe(0);
    expect(second.skippedExisting).toBe(3);
    expect(second.state).toBe(first.state);
    expect(second.state.items).toHaveLength(3);
  });

  it("keeps manually created locations intact (same objects, ids and positions)", () => {
    const manual = seeded([["Hill", "1300"], ["Water", "3218.688"]]);
    const outcome = importSplits(manual, raceA());
    if (!outcome.ok) throw new Error();
    expect(outcome.state.items.slice(0, 2)).toEqual(manual.items);
    expect(outcome.state.items[0]).toBe(manual.items[0]);
    // The 2-mile split (3218.688 m) already has a location (Water), so it isn't added again.
    expect(outcome.skippedExisting).toBe(1);
    expect(outcome.added).toBe(2); // 1 mile and 3 miles
    expect(outcome.state.items.filter((i) => Math.abs(i.distanceMeters - 3218.688) < 1e-6)).toHaveLength(1);
    expect(outcome.state.items.find((i) => Math.abs(i.distanceMeters - 3218.688) < 1e-6)?.name).toBe("Water");
  });

  it("imports into a list that already holds a manual location, and a second import still adds nothing", () => {
    const manual = seeded([["Hill", "1300"]]);
    const first = importSplits(manual, raceA());
    if (!first.ok) throw new Error();
    const second = importSplits(first.state, raceA());
    if (!second.ok) throw new Error();
    expect(second.added).toBe(0);
    expect(second.state.items).toHaveLength(4); // Hill + the 3 mile markers
  });

  it("handles the finish split: never imported, never duplicated", () => {
    const outcome = importSplits(INITIAL_LOCATIONS, raceA());
    if (!outcome.ok) throw new Error();
    expect(outcome.state.items.every((i) => i.distanceMeters < 5000)).toBe(true);
    expect(resolvePacingLocations(outcome.state.items, raceA()).locations.some((l) => l.isFinish)).toBe(false);
  });

  it("imported locations are independent: editable and deletable like any other", () => {
    const imported = importSplits(INITIAL_LOCATIONS, raceA());
    if (!imported.ok) throw new Error();
    const edited = unwrap2(updateLocation(imported.state, "loc-1", form("Start line", "150"), raceA()));
    expect(edited.items.find((i) => i.id === "loc-1")).toMatchObject({ name: "Start line", distanceMeters: 150 });
    const removed = removeLocation(edited, "loc-2");
    expect(removed.ok).toBe(true);
    // importing again afterwards puts back only what is missing (the 1-mile marker moved to 150 m, 2 miles was deleted)
    if (!removed.ok) throw new Error();
    const again = importSplits(removed.state, raceA());
    if (!again.ok) throw new Error();
    expect(again.added).toBe(2);
  });

  it("is not linked to the split table: a new calculation changes the times, not the locations", () => {
    const imported = importSplits(INITIAL_LOCATIONS, raceA());
    if (!imported.ok) throw new Error();
    const slower = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1500 });
    const before = resolvePacingLocations(imported.state.items, raceA()).locations;
    const after = resolvePacingLocations(imported.state.items, slower).locations;
    expect(after.map((l) => l.id)).toEqual(before.map((l) => l.id));
    expect(after.map((l) => l.distanceMeters)).toEqual(before.map((l) => l.distanceMeters));
    expect(after.map((l) => l.targetTimeSeconds)).not.toEqual(before.map((l) => l.targetTimeSeconds));
  });

  it("shows whole-mile splits in miles and the rest in meters", () => {
    const outcome = importSplits(INITIAL_LOCATIONS, raceA());
    if (!outcome.ok) throw new Error();
    expect(outcome.state.items.map((i) => i.unit)).toEqual(["mi", "mi", "mi"]);

    const shortRace = importSplits(INITIAL_LOCATIONS, race({ totalDistanceMeters: 800, targetTimeSeconds: 120 }));
    if (!shortRace.ok) throw new Error();
    expect(shortRace.state.items.map((i) => [i.name, i.unit])).toEqual([["200 m", "m"], ["400 m", "m"], ["600 m", "m"]]);
  });

  it("works with manual intervals", () => {
    const r = race({ totalDistanceMeters: 5000, targetTimeSeconds: 1200, intervalMode: "manual", intervalDistanceMeters: 1000 });
    const outcome = importSplits(INITIAL_LOCATIONS, r);
    if (!outcome.ok) throw new Error();
    expect(outcome.state.items.map((i) => i.name)).toEqual(["1000 m", "2000 m", "3000 m", "4000 m"]);
  });

  it("a race with only a finish imports nothing and leaves the state untouched", () => {
    const r = race({ totalDistanceMeters: 150, targetTimeSeconds: 30 });
    const outcome = importSplits(INITIAL_LOCATIONS, r);
    if (!outcome.ok) throw new Error();
    expect(outcome.added).toBe(0);
    expect(outcome.state).toBe(INITIAL_LOCATIONS);
  });

  it("an import that adds nothing keeps the undo slot", () => {
    const first = importSplits(INITIAL_LOCATIONS, raceA());
    if (!first.ok) throw new Error();
    const removed = removeLocation(first.state, "loc-1");
    if (!removed.ok) throw new Error();
    const noop = importSplits({ ...removed.state, items: first.state.items }, raceA());
    if (!noop.ok) throw new Error();
    expect(noop.added).toBe(0);
    expect(noop.state.lastDeleted?.id).toBe("loc-1");
  });
});

describe("consistency when the race changes", () => {
  it("a different target gives different times for the same locations", () => {
    const state = seeded([["a", "2000"]]);
    expect(at(times(state, raceA()), 0)[2]).toBeCloseTo(480, 9);
    expect(at(times(state, race({ totalDistanceMeters: 5000, targetTimeSeconds: 1500 })), 0)[2]).toBeCloseTo(600, 9);
  });

  it("a shorter race flags locations past the new finish and gives them no time", () => {
    const state = seeded([["near", "1000"], ["far", "4000"]]);
    const shorter = race({ totalDistanceMeters: 3000, targetTimeSeconds: 720 });
    const resolved = resolvePacingLocations(state.items, shorter);
    expect(resolved.locations.map((l) => l.name)).toEqual(["near"]);
    expect(resolved.outOfRange.map((o) => [o.location.name, o.reason])).toEqual([["far", "beyond-race"]]);
  });

  it("locations that were out of range come back when the race is long enough again", () => {
    const state = seeded([["far", "4000"]]);
    const shorter = race({ totalDistanceMeters: 3000, targetTimeSeconds: 720 });
    expect(resolvePacingLocations(state.items, shorter).locations).toHaveLength(0);
    expect(resolvePacingLocations(state.items, raceA()).locations).toHaveLength(1);
  });
});

describe("clearing", () => {
  it("removes everything and the undo slot, but keeps the id counter", () => {
    const state = seeded([["a", "1000"], ["b", "2000"]]);
    const removed = removeLocation(state, "loc-1");
    if (!removed.ok) throw new Error();
    const cleared = clearLocations(removed.state);
    expect(cleared).toEqual({ items: [], nextId: 3, lastDeleted: null });
  });
});

describe("form helpers", () => {
  it("naturalUnitFor: whole miles are miles, everything else meters", () => {
    expect(naturalUnitFor(MILE)).toBe("mi");
    expect(naturalUnitFor(2 * MILE)).toBe("mi");
    expect(naturalUnitFor(26 * MILE)).toBe("mi");
    expect(naturalUnitFor(1600)).toBe("m");
    expect(naturalUnitFor(800)).toBe("m");
    expect(naturalUnitFor(0.5 * MILE)).toBe("m");
    expect(naturalUnitFor(1.5 * MILE)).toBe("m");
  });

  it("locationToFormValues shows the distance in the unit it was entered in", () => {
    const state = seeded([["a", "1.2", "km"], ["b", "3.1", "mi"], ["c", "800", "m"]]);
    expect(state.items.map((i) => locationToFormValues(i))).toEqual([
      { name: "a", distanceText: "1.2", unit: "km" },
      { name: "b", distanceText: "3.1", unit: "mi" },
      { name: "c", distanceText: "800", unit: "m" },
    ]);
  });

  it("saving an edit form without changing anything keeps the same distance exactly", () => {
    const state = seeded([["a", "1.2", "km"], ["b", "3.1", "mi"], ["c", "1234.5678", "m"], ["d", "0.123456", "km"]], race({ totalDistanceMeters: 10000, targetTimeSeconds: 2400 }));
    for (const item of state.items) {
      const outcome = updateLocation(state, item.id, locationToFormValues(item), race({ totalDistanceMeters: 10000, targetTimeSeconds: 2400 }));
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
      expect(outcome.state.items.find((i) => i.id === item.id)?.distanceMeters).toBe(item.distanceMeters);
    }
  });
});

describe("display formatting (display only)", () => {
  it("formats in the unit the coach used", () => {
    expect(formatDistanceInUnit(800, "m")).toBe("800 m");
    expect(formatDistanceInUnit(1200, "km")).toBe("1.2 km");
    expect(formatDistanceInUnit(2 * MILE, "mi")).toBe("2 mi");
    expect(formatDistanceInUnit(3.1 * MILE, "mi")).toBe("3.1 mi");
    expect(formatDistanceInUnit(1234.5678, "km")).toBe("1.235 km");
    expect(formatMeters(333.3333)).toBe("333.33 m");
    expect(formatMeters(1609.344)).toBe("1609.34 m");
  });

  it("rounding for display never changes the stored value", () => {
    const state = seeded([["a", "1.23456", "km"]]);
    const stored = at(state.items, 0).distanceMeters;
    expect(stored).toBeCloseTo(1234.56, 9); // full precision kept (1.23456 km), not the 3-decimal display value
    expect(formatDistanceInUnit(stored, "km")).toBe("1.235 km");
    expect(at(state.items, 0).distanceMeters).toBe(stored); // formatting changed nothing
    expect(stored).not.toBeCloseTo(1235, 3);
  });
});
