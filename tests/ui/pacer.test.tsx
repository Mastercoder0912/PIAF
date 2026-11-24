// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import "./setup";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ---------- helpers ----------

function setup(): User {
  render(<App />);
  return userEvent.setup();
}

async function typeInto(user: User, box: HTMLElement, text: string) {
  await user.clear(box);
  if (text) await user.type(box, text);
}

interface RaceInput {
  distance: string;
  unit?: "Meters" | "Kilometers" | "Miles";
  time?: string;
  pace?: string;
  interval?: string;
}

/** Fill in and submit the calculator (default: 5 km in 20:00, which is exactly 0.24 s per meter). */
async function calculate(user: User, input: RaceInput = { distance: "5", time: "20:00" }) {
  await typeInto(user, screen.getByLabelText("Distance"), input.distance);
  if (input.unit) {
    await user.click(within(screen.getByRole("group", { name: "Distance unit" })).getByLabelText(input.unit));
  }
  if (input.pace !== undefined) {
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, screen.getByLabelText("Pace per mile"), input.pace);
  } else {
    await typeInto(user, screen.getByLabelText("Expected completion time"), input.time ?? "20:00");
  }
  if (input.interval) {
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, screen.getByLabelText("Interval distance"), input.interval);
  }
  await user.click(screen.getByRole("button", { name: "Calculate" }));
}

const openPacer = (user: User) => user.click(screen.getByRole("button", { name: "Pacer Mode" }));
const openCalculator = (user: User) => user.click(screen.getByRole("button", { name: "Calculator" }));

/** Calculate the default 5K in 20:00 and open Pacer Mode. */
async function pacer5K(user: User) {
  await calculate(user);
  await openPacer(user);
}

const addForm = () => screen.getByRole("form", { name: "Add location" });
const mainList = () => screen.getByRole("list", { name: "Pacing locations in race order" });

async function addLocation(user: User, name: string, distance: string, unit?: "Meters" | "Kilometers" | "Miles") {
  const form = within(addForm());
  await typeInto(user, form.getByLabelText("Location name"), name);
  await typeInto(user, form.getByLabelText("Distance from start"), distance);
  if (unit) await user.click(within(form.getByRole("group", { name: "Distance unit" })).getByLabelText(unit));
  await user.click(form.getByRole("button", { name: "Add location" }));
}

interface Row {
  id: string;
  name: string;
  dist: string;
  time: string;
}

/** The visible location list in order: id, name, distance text, target time text. */
function rows(): Row[] {
  return within(mainList())
    .getAllByRole("listitem")
    .map((li) => ({
      id: li.getAttribute("data-location-id") ?? "",
      name: li.querySelector(".loc-name")?.firstChild?.textContent ?? "",
      dist: li.querySelector(".loc-dist")?.textContent ?? "",
      time: li.querySelector(".loc-time")?.lastChild?.textContent ?? "",
    }));
}

const names = () => rows().map((r) => r.name);
const rowFor = (name: string) => {
  const row = rows().find((r) => r.name === name);
  if (!row) throw new Error(`No row named ${name}; have ${names().join(", ")}`);
  return row;
};

// ---------- tests ----------

describe("before a race has been calculated", () => {
  it("explains that a race must be calculated first, and offers no way to add locations", async () => {
    const user = setup();
    await openPacer(user);
    expect(screen.getByText("Calculate a race in the Calculator before creating pacing locations.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import splits as locations" })).not.toBeInTheDocument();
  });

  it("'Go to calculator' takes you back", async () => {
    const user = setup();
    await openPacer(user);
    await user.click(screen.getByRole("button", { name: "Go to calculator" }));
    expect(screen.getByRole("form", { name: "Race calculator" })).toBeInTheDocument();
  });

  it("a failed calculation also leaves no active race", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Calculate" })); // empty form: fails
    await openPacer(user);
    expect(screen.getByText(/Calculate a race in the Calculator/)).toBeInTheDocument();
  });
});

describe("after calculating a race", () => {
  it("shows the active race and the finish location, and no other locations yet", async () => {
    const user = setup();
    await pacer5K(user);
    const race = within(screen.getByRole("region", { name: "Active race" }));
    expect(race.getByText("5000 m")).toBeInTheDocument();
    expect(race.getByText("20:00.0")).toBeInTheDocument();
    expect(race.getByText("Pace").nextElementSibling).toHaveTextContent("6:26.2 /mi");
    expect(rows()).toEqual([{ id: "finish", name: "Finish", dist: "5000 m", time: "20:00.0" }]);
    expect(screen.getByText(/No locations yet/)).toBeInTheDocument();
  });

  it("the add form has no target-time input: times are always calculated", async () => {
    const user = setup();
    await pacer5K(user);
    const form = within(addForm());
    expect(form.getAllByRole("textbox")).toHaveLength(2);
    expect(form.queryByLabelText(/time/i)).not.toBeInTheDocument();
  });
});

describe("creating locations", () => {
  it("adds a location at an arbitrary distance, with its target time calculated", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    expect(rows()).toEqual([
      { id: "loc-1", name: "Water stop", dist: "1.2 km · 1200 m", time: "4:48.0" },
      { id: "finish", name: "Finish", dist: "5000 m", time: "20:00.0" },
    ]);
    expect(screen.getByText('Added "Water stop".')).toBeInTheDocument();
  });

  it("clears the form after adding, keeps the unit, and focuses the name box for the next one", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    const form = within(addForm());
    expect(form.getByLabelText("Location name")).toHaveValue("");
    expect(form.getByLabelText("Distance from start")).toHaveValue("");
    expect(within(form.getByRole("group", { name: "Distance unit" })).getByLabelText("Kilometers")).toBeChecked();
    expect(form.getByLabelText("Location name")).toHaveFocus();
  });

  it("locations are independent of the interval: a 5K with 400 m splits can watch 800, 1200, 2000, 3000, 4000", async () => {
    const user = setup();
    await calculate(user, { distance: "5", time: "20:00", interval: "400" });
    await openPacer(user);
    for (const meters of ["4000", "800", "3000", "1200", "2000"]) {
      await addLocation(user, `At ${meters}`, meters, "Meters");
    }
    expect(rows().map((r) => [r.name, r.time])).toEqual([
      ["At 800", "3:12.0"],
      ["At 1200", "4:48.0"],
      ["At 2000", "8:00.0"],
      ["At 3000", "12:00.0"],
      ["At 4000", "16:00.0"],
      ["Finish", "20:00.0"],
    ]);
  });

  it("an off-grid distance that no split would produce works too", async () => {
    const user = setup();
    await calculate(user, { distance: "5", time: "20:00", interval: "400" });
    await openPacer(user);
    await addLocation(user, "Odd", "1234.5", "Meters");
    expect(rowFor("Odd").time).toBe("4:56.3"); // 1234.5 * 0.24 = 296.28 s
  });

  it("lists locations by distance, not by the order they were created, and ids follow creation", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Four K", "4000", "Meters");
    await addLocation(user, "Eight hundred", "800", "Meters");
    await addLocation(user, "Two K", "2000", "Meters");
    expect(rows().map((r) => [r.id, r.name])).toEqual([
      ["loc-2", "Eight hundred"],
      ["loc-3", "Two K"],
      ["loc-1", "Four K"],
      ["finish", "Finish"],
    ]);
  });
});

describe("meters, kilometers and miles", () => {
  it("each unit lands on the right place and time (10 km at 6:00 per mile)", async () => {
    const user = setup();
    await calculate(user, { distance: "10", unit: "Kilometers", pace: "6:00" });
    await openPacer(user);
    await addLocation(user, "One km", "1", "Kilometers");
    await addLocation(user, "Five km", "5", "Kilometers");
    await addLocation(user, "Mile", "1", "Miles");
    await addLocation(user, "Two miles", "2", "Miles");
    await addLocation(user, "Three point one", "3.1", "Miles");
    await addLocation(user, "Meters", "2500", "Meters");

    // Expected times computed independently: distance / 1609.344 m * 360 s.
    expect(rows().map((r) => [r.name, r.dist, r.time])).toEqual([
      ["One km", "1 km · 1000 m", "3:43.7"],
      ["Mile", "1 mi · 1609.34 m", "6:00.0"],
      ["Meters", "2500 m", "9:19.2"],
      ["Two miles", "2 mi · 3218.69 m", "12:00.0"],
      ["Three point one", "3.1 mi · 4988.97 m", "18:36.0"],
      ["Five km", "5 km · 5000 m", "18:38.5"],
      ["Finish", "10000 m", "37:16.9"],
    ]);
  });
});

describe("editing a location", () => {
  async function withWaterStop() {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await user.click(screen.getByRole("button", { name: "Edit Water stop" }));
    return user;
  }

  it("opens a form pre-filled with the name, the distance and the unit it was entered in", async () => {
    await withWaterStop();
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    expect(form.getByLabelText("Edit name")).toHaveValue("Water stop");
    expect(form.getByLabelText("Edit distance")).toHaveValue("1.2");
    expect(within(form.getByRole("group", { name: "Edit distance unit" })).getByLabelText("Kilometers")).toBeChecked();
  });

  it("changing the distance recalculates the time and moves the location, keeping its id", async () => {
    const user = await withWaterStop();
    await addLocation(user, "Hill", "2000", "Meters");
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit distance"), "3");
    await user.click(form.getByRole("button", { name: "Save changes" }));

    expect(rows().map((r) => [r.id, r.name, r.dist, r.time])).toEqual([
      ["loc-2", "Hill", "2000 m", "8:00.0"],
      ["loc-1", "Water stop", "3 km · 3000 m", "12:00.0"],
      ["finish", "Finish", "5000 m", "20:00.0"],
    ]);
    expect(screen.queryByRole("form", { name: "Edit location" })).not.toBeInTheDocument();
    expect(screen.getByText('Saved "Water stop".')).toBeInTheDocument();
  });

  it("can change the name and the unit", async () => {
    const user = await withWaterStop();
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit name"), "Aid station");
    await typeInto(user, form.getByLabelText("Edit distance"), "1500");
    await user.click(within(form.getByRole("group", { name: "Edit distance unit" })).getByLabelText("Meters"));
    await user.click(form.getByRole("button", { name: "Save changes" }));
    expect(rowFor("Aid station")).toEqual({ id: "loc-1", name: "Aid station", dist: "1500 m", time: "6:00.0" });
  });

  it("saving without changes keeps everything the same", async () => {
    const user = await withWaterStop();
    await user.click(within(screen.getByRole("form", { name: "Edit location" })).getByRole("button", { name: "Save changes" }));
    expect(rowFor("Water stop")).toEqual({ id: "loc-1", name: "Water stop", dist: "1.2 km · 1200 m", time: "4:48.0" });
  });

  it("an invalid edit shows an error and is not saved", async () => {
    const user = await withWaterStop();
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit name"), "");
    await typeInto(user, form.getByLabelText("Edit distance"), "9");
    await user.click(within(form.getByRole("group", { name: "Edit distance unit" })).getByLabelText("Kilometers"));
    await user.click(form.getByRole("button", { name: "Save changes" }));
    expect(form.getByText("Enter a name for this location.")).toBeInTheDocument();
    expect(form.getByText(/9000 m is beyond the 5000 m race distance/)).toBeInTheDocument();
    expect(form.getByLabelText("Edit name")).toHaveFocus();

    await user.click(form.getByRole("button", { name: "Cancel" }));
    expect(rowFor("Water stop").dist).toBe("1.2 km · 1200 m"); // unchanged
  });

  it("cannot be edited onto another location's distance", async () => {
    const user = await withWaterStop();
    await addLocation(user, "Hill", "2000", "Meters");
    await user.click(screen.getByRole("button", { name: "Edit Hill" }));
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit distance"), "1200");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    expect(form.getByText(/"Water stop" is already at 1200 m/)).toBeInTheDocument();
  });

  it("Cancel closes the form with no change and returns focus to the Edit button", async () => {
    const user = await withWaterStop();
    await user.click(within(screen.getByRole("form", { name: "Edit location" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit location" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Water stop" })).toHaveFocus();
  });
});

describe("deleting a location", () => {
  it("removes it and offers Undo, which restores the same location with the same id", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await addLocation(user, "Hill", "2000", "Meters");

    await user.click(screen.getByRole("button", { name: "Delete Water stop" }));
    expect(names()).toEqual(["Hill", "Finish"]);
    expect(screen.getByText('Deleted "Water stop".')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(rows().map((r) => [r.id, r.name, r.time])).toEqual([
      ["loc-1", "Water stop", "4:48.0"],
      ["loc-2", "Hill", "8:00.0"],
      ["finish", "Finish", "20:00.0"],
    ]);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.getByText('Restored "Water stop".')).toBeInTheDocument();
  });

  it("the undo offer goes away once you do something else", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await user.click(screen.getByRole("button", { name: "Delete Water stop" }));
    await addLocation(user, "Other", "3000", "Meters");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("a deleted distance can be used again", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await user.click(screen.getByRole("button", { name: "Delete Water stop" }));
    await addLocation(user, "Replacement", "1200", "Meters");
    expect(rowFor("Replacement").id).toBe("loc-2"); // ids are never reused
  });
});

describe("validation in the add form", () => {
  async function submitBad(name: string, distance: string, unit?: "Meters" | "Kilometers" | "Miles") {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, name, distance, unit ?? "Meters");
    return user;
  }

  it("rejects an empty name", async () => {
    await submitBad("", "1000");
    expect(screen.getByText("Enter a name for this location.")).toBeInTheDocument();
    expect(screen.getByLabelText("Location name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Location name")).toHaveFocus();
    expect(names()).toEqual(["Finish"]);
  });

  it("rejects a name of only spaces", async () => {
    await submitBad("    ", "1000");
    expect(screen.getByText("Enter a name for this location.")).toBeInTheDocument();
    expect(names()).toEqual(["Finish"]);
  });

  it.each(["0", "-100"])("rejects a distance of %s", async (distance) => {
    await submitBad("A", distance);
    expect(screen.getByText("Distance must be a number greater than 0.")).toBeInTheDocument();
    expect(names()).toEqual(["Finish"]);
  });

  it.each([["blank", "", "Enter a distance from the start."], ["letters", "abc", "Distance must be a number (for example 1200 or 1.5)."]])(
    "rejects a %s distance",
    async (_label, distance, message) => {
      await submitBad("A", distance);
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(names()).toEqual(["Finish"]);
    },
  );

  it("rejects a distance beyond the race, naming both distances", async () => {
    await submitBad("Too far", "6", "Kilometers");
    expect(screen.getByText(/6000 m is beyond the 5000 m race distance/)).toBeInTheDocument();
    expect(names()).toEqual(["Finish"]);
  });

  it("rejects a location at the finish: it already exists", async () => {
    await submitBad("End", "5", "Kilometers");
    expect(screen.getByText(/That is the finish line \(5000 m\), which is added automatically/)).toBeInTheDocument();
    expect(names()).toEqual(["Finish"]);
  });

  it("rejects a duplicate distance and names the existing location, even in another unit", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1200", "Meters");
    await addLocation(user, "Other", "1.2", "Kilometers");
    expect(screen.getByText(/"Water stop" is already at 1200 m/)).toBeInTheDocument();
    expect(names()).toEqual(["Water stop", "Finish"]);
  });

  it("shows a name error and a distance error together", async () => {
    await submitBad("", "abc");
    expect(screen.getByText("Enter a name for this location.")).toBeInTheDocument();
    expect(screen.getByText(/must be a number/)).toBeInTheDocument();
  });

  it("clears each error as soon as that field is edited", async () => {
    const user = await submitBad("", "abc");
    await user.type(screen.getByLabelText("Location name"), "A");
    expect(screen.queryByText("Enter a name for this location.")).not.toBeInTheDocument();
    expect(screen.getByText(/must be a number/)).toBeInTheDocument();
  });

  it("keeps what was typed when there's an error, so it can be corrected", async () => {
    await submitBad("Hill", "abc");
    expect(screen.getByLabelText("Location name")).toHaveValue("Hill");
    expect(screen.getByLabelText("Distance from start")).toHaveValue("abc");
  });

  it("1600 m and one mile are different places, so both are allowed", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Metric mile", "1600", "Meters");
    await addLocation(user, "Real mile", "1", "Miles");
    expect(rows().map((r) => [r.name, r.time])).toEqual([
      ["Metric mile", "6:24.0"],
      ["Real mile", "6:26.2"],
      ["Finish", "20:00.0"],
    ]);
  });
});

describe("the finish location", () => {
  it("is shown last, highlighted, marked automatic, and cannot be edited or deleted", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    const finish = within(mainList()).getAllByRole("listitem").at(-1) as HTMLElement;
    expect(finish).toHaveClass("finish-loc");
    expect(within(finish).getByText("Automatic")).toBeInTheDocument();
    expect(within(finish).getByText(/can't be edited or deleted/)).toBeInTheDocument();
    expect(within(finish).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(Edit|Delete) Finish/ })).not.toBeInTheDocument();
  });

  it("keeps the exact calculated completion time", async () => {
    const user = setup();
    await calculate(user, { distance: "5", pace: "7:00" });
    await openPacer(user);
    expect(rowFor("Finish").time).toBe("21:44.9");
  });
});

describe("importing the calculator's splits", () => {
  it("turns every split (except the finish, which is automatic) into a location with the split's time", async () => {
    const user = setup();
    await pacer5K(user);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    // A 5K is longer than a mile, so the calculator's splits are the whole-mile markers and the finish only.
    // Times are 0.24 s per meter (20:00 over 5000 m): 1609.344 -> 386.24, 3218.688 -> 772.49, 4828.032 -> 1158.73.
    expect(rows().map((r) => [r.name, r.dist, r.time])).toEqual([
      ["1 mile", "1 mi · 1609.34 m", "6:26.2"],
      ["2 miles", "2 mi · 3218.69 m", "12:52.5"],
      ["3 miles", "3 mi · 4828.03 m", "19:18.7"],
      ["Finish", "5000 m", "20:00.0"],
    ]);
    expect(rows().filter((r) => r.name === "Finish")).toHaveLength(1);
    expect(screen.getByText("Imported 3 locations from the split table.")).toBeInTheDocument();
  });

  it("matches the calculator's split table time for time", async () => {
    const user = setup();
    await pacer5K(user);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    const imported = rows().map((r) => r.time);
    await openCalculator(user);
    const table = screen.getByRole("table");
    const tableTimes = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.lastElementChild?.textContent);
    expect(imported).toEqual(tableTimes);
  });

  it("importing again adds nothing and says so", async () => {
    const user = setup();
    await pacer5K(user);
    const importButton = screen.getByRole("button", { name: "Import splits as locations" });
    await user.click(importButton);
    const before = rows();
    await user.click(importButton);
    expect(rows()).toEqual(before);
    expect(screen.getByText("Nothing new to import: every split already has a location.")).toBeInTheDocument();
  });

  it("keeps locations you made, and skips splits at distances that already have one", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Hill", "1300", "Meters");
    await addLocation(user, "Water", "2", "Miles"); // exactly where the 2-mile split is
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));

    expect(rowFor("Hill")).toMatchObject({ id: "loc-1", dist: "1300 m", time: "5:12.0" });
    expect(rowFor("Water")).toMatchObject({ id: "loc-2", dist: "2 mi · 3218.69 m" });
    expect(rows().filter((r) => r.dist === "2 mi · 3218.69 m")).toHaveLength(1);
    expect(names()).not.toContain("2 miles");
    expect(rows()).toHaveLength(5); // 2 imported (1 and 3 miles) + Hill + Water + the finish
    expect(screen.getByText("Imported 2 locations from the split table. 1 split already had a location and was skipped.")).toBeInTheDocument();
  });

  it("imported locations are independent: edit one, delete one, and a re-import only fills the gaps", async () => {
    const user = setup();
    await pacer5K(user);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));

    await user.click(screen.getByRole("button", { name: "Edit 1 mile" }));
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit name"), "Start straight");
    await typeInto(user, form.getByLabelText("Edit distance"), "150");
    await user.click(within(form.getByRole("group", { name: "Edit distance unit" })).getByLabelText("Meters"));
    await user.click(form.getByRole("button", { name: "Save changes" }));
    expect(rowFor("Start straight")).toMatchObject({ dist: "150 m", time: "0:36.0" });

    await user.click(screen.getByRole("button", { name: "Delete 2 miles" }));
    expect(names()).not.toContain("2 miles");

    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    // The 1-mile and 2-mile splits return; the 3-mile split already has a location (the edited one moved to 150 m).
    expect(screen.getByText("Imported 2 locations from the split table. 1 split already had a location and was skipped.")).toBeInTheDocument();
    expect(names().filter((n) => n === "1 mile" || n === "2 miles")).toHaveLength(2);
    expect(names()).toContain("Start straight");
  });

  it("works with manual intervals", async () => {
    const user = setup();
    await calculate(user, { distance: "5", time: "20:00", interval: "1000" });
    await openPacer(user);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    expect(names()).toEqual(["1000 m", "2000 m", "3000 m", "4000 m", "Finish"]);
  });

  it("explains when there is nothing to import", async () => {
    const user = setup();
    await calculate(user, { distance: "150", unit: "Meters", time: "0:30" });
    await openPacer(user);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    expect(screen.getByText(/There are no splits to import/)).toBeInTheDocument();
    expect(names()).toEqual(["Finish"]);
  });
});

describe("staying consistent with the calculator", () => {
  it("recalculating with a new target updates every time; no old times are kept", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Two K", "2000", "Meters");
    expect(rowFor("Two K").time).toBe("8:00.0");

    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "25:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await openPacer(user);
    expect(rowFor("Two K").time).toBe("10:00.0");
    expect(rowFor("Finish").time).toBe("25:00.0");
    expect(rowFor("Two K").id).toBe("loc-1");
  });

  it("a longer or shorter race distance changes the finish and keeps the locations that still fit", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Two K", "2000", "Meters");
    await openCalculator(user);
    await calculate(user, { distance: "10", time: "40:00" });
    await openPacer(user);
    expect(rows().map((r) => [r.name, r.time])).toEqual([
      ["Two K", "8:00.0"],
      ["Finish", "40:00.0"],
    ]);
    expect(rowFor("Finish").dist).toBe("10000 m");
  });

  it("warns, but keeps the last calculation's times, when the calculator inputs were changed and not recalculated", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Two K", "2000", "Meters");
    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "19:00");
    await openPacer(user);
    expect(screen.getByText(/calculator inputs have changed/i)).toBeInTheDocument();
    expect(rowFor("Two K").time).toBe("8:00.0"); // still the last calculation, and it says so

    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await openPacer(user);
    expect(screen.queryByText(/calculator inputs have changed/i)).not.toBeInTheDocument();
    expect(rowFor("Two K").time).toBe("7:36.0"); // 2000 * 0.228
  });

  it("a shorter race moves locations past the new finish to 'Needs attention' with no time", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Near", "1000", "Meters");
    await addLocation(user, "Far", "4000", "Meters");
    await openCalculator(user);
    await calculate(user, { distance: "3", time: "15:00" });
    await openPacer(user);

    expect(rows().map((r) => [r.name, r.time])).toEqual([
      ["Near", "5:00.0"],
      ["Finish", "15:00.0"],
    ]);
    const attention = screen.getByRole("list", { name: "Locations that don't fit the current race" });
    expect(within(attention).getByText("Far")).toBeInTheDocument();
    expect(within(attention).getByText(/Beyond the 3000 m race distance/)).toBeInTheDocument();
    expect(within(attention).getByLabelText("No target time")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
  });

  it("a flagged location can be edited back into the race, or deleted", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Far", "4000", "Meters");
    await openCalculator(user);
    await calculate(user, { distance: "3", time: "15:00" });
    await openPacer(user);

    await user.click(screen.getByRole("button", { name: "Edit Far" }));
    const form = within(screen.getByRole("form", { name: "Edit location" }));
    await typeInto(user, form.getByLabelText("Edit distance"), "2500");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    expect(rowFor("Far").time).toBe("12:30.0"); // 2500 * 0.3 s/m
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });

  it("a flagged location comes back by itself when the race is long enough again", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Far", "4000", "Meters");
    await openCalculator(user);
    await calculate(user, { distance: "3", time: "15:00" });
    await calculate(user, { distance: "5", time: "20:00" });
    await openPacer(user);
    expect(rowFor("Far").time).toBe("16:00.0");
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });

  it("a location that ends up exactly on the new finish is flagged, not duplicated", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Three K", "3000", "Meters");
    await openCalculator(user);
    await calculate(user, { distance: "3", time: "15:00" });
    await openPacer(user);
    expect(rows().filter((r) => r.dist === "3000 m")).toHaveLength(1); // only the finish
    expect(screen.getByText(/Now at the same place as the finish line/)).toBeInTheDocument();
  });

  it("locations survive going back and forth between screens", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await openCalculator(user);
    await openPacer(user);
    expect(rowFor("Water stop").id).toBe("loc-1");
  });

  it("after a failed calculation the saved locations are kept and reappear when a race exists again", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "20:99");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await openPacer(user);
    expect(screen.getByText(/Calculate a race in the Calculator/)).toBeInTheDocument();
    expect(screen.getByText(/Your 1 saved location will reappear/)).toBeInTheDocument();

    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await openPacer(user);
    expect(rowFor("Water stop").time).toBe("4:48.0");
  });
});

describe("calculator Reset and pacing locations", () => {
  it("the confirmation says the locations will be cleared too, and confirming clears them", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "A", "1000", "Meters");
    await addLocation(user, "B", "2000", "Meters");
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("your 2 pacing locations");
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));

    await openPacer(user);
    expect(screen.getByText(/Calculate a race in the Calculator/)).toBeInTheDocument();
    expect(screen.queryByText(/saved location/)).not.toBeInTheDocument();

    await openCalculator(user);
    await calculate(user);
    await openPacer(user);
    expect(names()).toEqual(["Finish"]);
  });

  it("uses the singular for one location", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "A", "1000", "Meters");
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("your 1 pacing location?");
  });

  it("Keep editing leaves the locations alone", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "A", "1000", "Meters");
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await openPacer(user);
    expect(names()).toEqual(["A", "Finish"]);
  });

  it("still asks before resetting when the form is empty and the only thing at stake is the locations", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "A", "1000", "Meters");
    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Distance"), "");
    await typeInto(user, screen.getByLabelText("Expected completion time"), "");
    await user.click(screen.getByRole("button", { name: "Calculate" })); // fails: no result any more
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("ids are not reused after a reset", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "A", "1000", "Meters");
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));
    await calculate(user);
    await openPacer(user);
    await addLocation(user, "B", "1000", "Meters");
    expect(rowFor("B").id).toBe("loc-2");
  });
});

describe("accessibility", () => {
  it("has named lists, labelled inputs, and per-row button names", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    for (const box of within(addForm()).getAllByRole("textbox")) expect(box).toHaveAccessibleName();
    expect(screen.getByRole("button", { name: "Edit Water stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Water stop" })).toBeInTheDocument();
    expect(mainList()).toBeInTheDocument();
  });

  it("each row's time is announced as a target time", async () => {
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    const row = within(mainList()).getAllByRole("listitem")[0] as HTMLElement;
    expect(row).toHaveTextContent("Target time 4:48.0");
  });

  it("makes no network requests", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup();
    await pacer5K(user);
    await addLocation(user, "Water stop", "1.2", "Kilometers");
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
