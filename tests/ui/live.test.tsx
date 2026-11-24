// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import "./setup";

type User = ReturnType<typeof userEvent.setup>;
type Unit = "Meters" | "Kilometers" | "Miles";

/** A clock the test controls. Pressing a button reads it at that instant, exactly like performance.now() would. */
let now = 0;
const clock = () => now;
const advance = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now = 5_000; // not zero: the stopwatch must not assume the clock starts at 0
  Element.prototype.scrollIntoView = vi.fn();
});

// ---------- helpers ----------

function setup(): User {
  render(<App clock={clock} />);
  return userEvent.setup();
}

async function typeInto(user: User, box: HTMLElement, text: string) {
  await user.clear(box);
  if (text) await user.type(box, text);
}

/** 5 km in 20:00 by default, i.e. exactly 0.24 s per meter. */
async function calculate(user: User, distance = "5", time = "20:00") {
  await typeInto(user, screen.getByLabelText("Distance"), distance);
  await typeInto(user, screen.getByLabelText("Expected completion time"), time);
  await user.click(screen.getByRole("button", { name: "Calculate" }));
}

const openPacer = (user: User) => user.click(screen.getByRole("button", { name: /^Pacer Mode/ }));
const openCalculator = (user: User) => user.click(screen.getByRole("button", { name: /^Calculator/ }));
const showLive = (user: User) => user.click(screen.getByRole("button", { name: "Live Pacer" }));
const showLocations = (user: User) => user.click(screen.getByRole("button", { name: "Locations" }));

async function addLocation(user: User, name: string, meters: string, unit: Unit = "Meters") {
  const form = within(screen.getByRole("form", { name: "Add location" }));
  await typeInto(user, form.getByLabelText("Location name"), name);
  await typeInto(user, form.getByLabelText("Distance from start"), meters);
  await user.click(within(form.getByRole("group", { name: "Distance unit" })).getByLabelText(unit));
  await user.click(form.getByRole("button", { name: "Add location" }));
}

/** 5K in 20:00 with A at 1000 m (target 4:00.00) and B at 2000 m (target 8:00.00), then show Live Pacer. */
async function liveWithAB(user: User) {
  await calculate(user);
  await openPacer(user);
  await addLocation(user, "A", "1000");
  await addLocation(user, "B", "2000");
  await showLive(user);
}

/** The state pill ("Ready" / "Running" / "Paused" / "Finished"). */
const phaseLabel = () => document.querySelector(".live-phase") as HTMLElement;
const stopwatch = () => screen.getByRole("timer", { name: "Elapsed time" });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const start = (user: User) => user.click(button("Start"));
const record = (user: User) => user.click(button("Record Passing Time"));
const recordedList = () => screen.queryByRole("list", { name: /Recorded passing times/ });

interface Rec {
  id: string;
  name: string;
  target: string;
  actual: string;
  diff: string;
  status: string;
}
/** Recorded rows, latest first, read from what is on screen. */
function recs(): Rec[] {
  const list = recordedList();
  if (!list) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((li) => {
      const value = (label: string) =>
        Array.from(li.querySelectorAll("dt"))
          .find((dt) => dt.textContent === label)
          ?.nextElementSibling?.firstChild?.textContent ?? "";
      return {
        id: li.getAttribute("data-location-id") ?? "",
        name: li.querySelector(".loc-name")?.textContent ?? "",
        target: value("Target"),
        actual: value("Actual"),
        diff: value("Difference"),
        status: li.querySelector(".status")?.textContent ?? "",
      };
    });
}

// ---------- tests ----------

describe("opening Live Pacer", () => {
  it("Locations stays the default Pacer Mode view; Live Pacer is one tap away", async () => {
    const user = setup();
    await calculate(user);
    await openPacer(user);
    expect(screen.getByRole("heading", { name: "Pacing locations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Locations" })).toHaveAttribute("aria-pressed", "true");
    await showLive(user);
    expect(screen.getByRole("button", { name: "Live Pacer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "Pacing locations" })).not.toBeInTheDocument();
  });

  it("ready state: stopwatch at zero, first location previewed, Record and Reset unavailable", async () => {
    const user = setup();
    await liveWithAB(user);
    expect(stopwatch()).toHaveTextContent("00:00.00");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First location" })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("4:00.00")).toBeInTheDocument();
    expect(button("Record Passing Time")).toBeDisabled();
    expect(button("Reset")).toBeDisabled();
    expect(button("Start")).toBeEnabled();
    expect(screen.getByText("Start the stopwatch to record passing times.")).toBeInTheDocument();
    expect(screen.getByText("No passing times recorded yet.")).toBeInTheDocument();
  });

  it("with no locations the finish is the only stop", async () => {
    const user = setup();
    await calculate(user);
    await openPacer(user);
    await showLive(user);
    expect(screen.getByRole("heading", { name: "Finish line" })).toBeInTheDocument();
    expect(screen.getByText("20:00.00")).toBeInTheDocument();
  });
});

describe("stopwatch controls", () => {
  it("Start begins at zero and the button becomes Pause", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    expect(phaseLabel()).toHaveTextContent("Running");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(button("Pause")).toBeInTheDocument();
    expect(button("Record Passing Time")).toBeEnabled();
    expect(button("Reset")).toBeEnabled();
  });

  it("the display follows the clock while running (read from timestamps, not counted)", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(2_500);
    await waitFor(() => expect(stopwatch()).toHaveTextContent("00:02.50"));
    advance(57_790); // a long gap with no frames in between still lands on the right value
    await waitFor(() => expect(stopwatch()).toHaveTextContent("01:00.29"));
  });

  it("Pause freezes the time; Resume continues from it without resetting", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(65_430);
    await user.click(button("Pause"));
    expect(stopwatch()).toHaveTextContent("01:05.43");
    expect(screen.getByText("Paused")).toBeInTheDocument();

    advance(10_000); // time passing while paused doesn't count
    expect(stopwatch()).toHaveTextContent("01:05.43");

    await user.click(button("Resume"));
    advance(4_570);
    await user.click(button("Pause"));
    expect(stopwatch()).toHaveTextContent("01:10.00");
  });

  it("the same button toggles Start / Pause / Resume, so keyboard focus stays on it", async () => {
    const user = setup();
    await liveWithAB(user);
    button("Start").focus();
    await user.keyboard("{Enter}");
    expect(button("Pause")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(button("Resume")).toHaveFocus();
  });

  it("Record is unavailable while paused, with an explanation", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(1_000);
    await user.click(button("Pause"));
    expect(button("Record Passing Time")).toBeDisabled();
    expect(screen.getByText(/paused\. Resume it to record/)).toBeInTheDocument();
  });

  it("hours are shown when needed: HH:MM:SS.hh", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(3_723_450);
    await user.click(button("Pause"));
    expect(stopwatch()).toHaveTextContent("01:02:03.45");
  });

  it("cancels its animation frames when it unmounts", async () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const user = userEvent.setup();
    const view = render(<App clock={clock} />);
    await calculate(user);
    await openPacer(user);
    await showLive(user);
    await start(user);
    cancel.mockClear();
    view.unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });
});

describe("recording passing times", () => {
  it("records the time at the press, shows target / actual / difference / status, and advances", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);

    expect(recs()).toEqual([{ id: "loc-1", name: "A", target: "4:00.00", actual: "3:58.50", diff: "-1.50s", status: "AHEAD" }]);
    expect(screen.getByRole("heading", { name: "Next location" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Next location/ })).getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Location 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 recorded")).toBeInTheDocument();
  });

  it("captures the exact moment of the press, even if the screen hasn't redrawn since", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(61_234.5); // no frame has run since Start: the display may still be stale
    await record(user);
    expect(recs()[0]?.actual).toBe("1:01.23"); // 61.2345 s, truncated like a stopwatch
  });

  it("shows ahead, on target and behind with words, signs and the right numbers", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500); // A: 3:58.50 vs 4:00.00 -> ahead 1.50
    await record(user);
    advance(242_000); // B: 480.5 vs 480 -> on target +0.50
    await record(user);
    advance(2_250);
    // finish: 482.75 elapsed... target 1200, so well ahead
    await record(user);
    const rows = recs().reverse();
    expect(rows.map((r) => [r.name, r.diff, r.status])).toEqual([
      ["A", "-1.50s", "AHEAD"],
      ["B", "+0.50s", "ON TARGET"],
      ["Finish", "-717.25s", "AHEAD"],
    ]);
  });

  it("a behind result is labelled BEHIND with a plus sign", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(242_250); // A at 242.25 vs 240
    await record(user);
    expect(recs()[0]).toMatchObject({ diff: "+2.25s", status: "BEHIND" });
  });

  it("the time keeps counting through pause/resume when recorded", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await user.click(button("Pause"));
    advance(300_000);
    await user.click(button("Resume"));
    advance(120_000);
    await record(user); // 220 s of running time
    expect(recs()[0]?.actual).toBe("3:40.00");
  });

  it("attaches each time to the location's stable id", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await record(user);
    advance(100_000);
    await record(user);
    expect(recs().map((r) => r.id)).toEqual(["loc-2", "loc-1"]); // latest first
  });

  it("lists the latest result first", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);
    advance(242_000);
    await record(user);
    expect(recs().map((r) => r.name)).toEqual(["B", "A"]);
  });

  it("an accidental double tap records once and says it ignored the repeat", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await user.dblClick(button("Record Passing Time"));
    expect(recs()).toHaveLength(1);
    expect(screen.getByText(/Ignored: that location was just recorded/)).toBeInTheDocument();
  });

  it("a second press 100 ms later is also ignored; one after the guard window is accepted", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await record(user);
    advance(100);
    await record(user);
    expect(recs()).toHaveLength(1);
    advance(400); // 500 ms since the first record
    await record(user);
    expect(recs()).toHaveLength(2);
    expect(screen.queryByText(/Ignored/)).not.toBeInTheDocument();
  });
});

describe("finishing", () => {
  async function runToFinish(user: User) {
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user); // A 3:58.50, -1.50
    advance(242_000);
    await record(user); // B 8:00.50, +0.50
    advance(715_700);
    await record(user); // Finish at 1196.2 s, target 1200 -> -3.80
  }

  it("the finish is recordable like any other location, and shown as the Finish line beforehand", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);
    advance(242_000);
    await record(user);
    expect(screen.getByRole("heading", { name: "Finish line" })).toBeInTheDocument();
    expect(screen.getByText("Last location (3 of 3)")).toBeInTheDocument();
    expect(screen.getByText("20:00.00")).toBeInTheDocument();
  });

  it("completes the session: total time, target, overall result, and the full table stays visible", async () => {
    const user = setup();
    await runToFinish(user);
    const summary = within(screen.getByRole("region", { name: "Race complete" }));
    expect(summary.getByText("19:56.20")).toBeInTheDocument();
    expect(summary.getByText("20:00.00")).toBeInTheDocument();
    expect(summary.getByText("-3.80s")).toBeInTheDocument();
    expect(summary.getByText("AHEAD")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(recs().map((r) => r.name)).toEqual(["Finish", "B", "A"]);
    expect(screen.getByText("3 of 3 recorded")).toBeInTheDocument();
  });

  it("the stopwatch shows the finish time and stays there; nothing more can be recorded", async () => {
    const user = setup();
    await runToFinish(user);
    expect(stopwatch()).toHaveTextContent("19:56.20");
    advance(60_000);
    expect(stopwatch()).toHaveTextContent("19:56.20");
    expect(screen.queryByRole("button", { name: "Record Passing Time" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pause|Resume|Start/ })).not.toBeInTheDocument();
  });

  it("a finish behind target is reported as BEHIND overall", async () => {
    const user = setup();
    await calculate(user);
    await openPacer(user);
    await showLive(user);
    await start(user);
    advance(1_203_000);
    await record(user);
    const summary = within(screen.getByRole("region", { name: "Race complete" }));
    expect(summary.getByText("+3.00s")).toBeInTheDocument();
    expect(summary.getByText("BEHIND")).toBeInTheDocument();
  });
});

describe("reset", () => {
  it("asks first (inline), saying what will be cleared, and Escape cancels without losing anything", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);
    await user.click(button("Reset"));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("clears the 1 recorded passing time");
    expect(button("Keep session")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(button("Reset")).toHaveFocus();
    expect(recs()).toHaveLength(1);
    expect(button("Pause")).toBeInTheDocument();
  });

  it("'Keep session' also leaves everything as it was", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(1_000);
    await user.click(button("Reset"));
    await user.click(button("Keep session"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(phaseLabel()).toHaveTextContent("Running");
  });

  it("confirming returns to the initial state: zero time, no records, Start available and focused", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);
    await user.click(button("Reset"));
    await user.click(button("Yes, reset session"));

    expect(stopwatch()).toHaveTextContent("00:00.00");
    expect(recs()).toEqual([]);
    expect(screen.getByText("No passing times recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await waitFor(() => expect(button("Start")).toHaveFocus());
    expect(button("Reset")).toBeDisabled();
  });

  it("asks even when nothing is recorded yet, once the stopwatch has started", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await user.click(button("Reset"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("returns it to zero");
  });

  it("a new session can be started after a reset, from zero", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(50_000);
    await user.click(button("Reset"));
    await user.click(button("Yes, reset session"));
    advance(30_000);
    await start(user);
    advance(1_000);
    await user.click(button("Pause"));
    expect(stopwatch()).toHaveTextContent("00:01.00");
  });

  it("also works after the race is finished", async () => {
    const user = setup();
    await calculate(user);
    await openPacer(user);
    await showLive(user);
    await start(user);
    advance(1_200_000);
    await record(user);
    await user.click(button("Reset"));
    await user.click(button("Yes, reset session"));
    expect(screen.queryByRole("region", { name: "Race complete" })).not.toBeInTheDocument();
    expect(stopwatch()).toHaveTextContent("00:00.00");
  });
});

describe("editing locations during a session", () => {
  const lockedControls = () => [
    screen.getByRole("button", { name: "Edit A" }),
    screen.getByRole("button", { name: "Delete A" }),
    screen.getByRole("button", { name: "Add location" }),
    screen.getByRole("button", { name: "Import splits as locations" }),
  ];

  it("while running, add / edit / delete / import are disabled and the reason is explained", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await showLocations(user);
    for (const control of lockedControls()) expect(control).toBeDisabled();
    expect(screen.getByText(/locked while the stopwatch is running/)).toBeInTheDocument();
    // the list itself is still readable
    expect(screen.getByRole("list", { name: "Pacing locations in race order" })).toBeInTheDocument();
  });

  it("paused with nothing recorded: editing is allowed again", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(1_000);
    await user.click(button("Pause"));
    await showLocations(user);
    for (const control of lockedControls()) expect(control).toBeEnabled();
    expect(screen.queryByText(/Locations are locked/)).not.toBeInTheDocument();
  });

  it("once a time is recorded, locations stay locked even when paused, until reset", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await record(user);
    await user.click(button("Pause"));
    await showLocations(user);
    for (const control of lockedControls()) expect(control).toBeDisabled();
    expect(screen.getByText(/passing times have been recorded\. Reset the live session/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to Live Pacer" }));
    await user.click(button("Reset"));
    await user.click(button("Yes, reset session"));
    await showLocations(user);
    for (const control of lockedControls()) expect(control).toBeEnabled();
  });

  it("locked after the finish as well", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(1_200_000);
    await record(user);
    await record(user).catch(() => undefined);
    await showLocations(user);
    expect(screen.getByRole("button", { name: "Edit A" })).toBeDisabled();
  });

  it("nothing is discarded by locking: the locations and their times are still shown", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await showLocations(user);
    const list = within(screen.getByRole("list", { name: "Pacing locations in race order" }));
    expect(list.getByText("A")).toBeInTheDocument();
    expect(list.getByText("B")).toBeInTheDocument();
    expect(list.getByText("Finish")).toBeInTheDocument();
  });
});

describe("a changed race or locations during a session", () => {
  it("the session keeps its original targets and warns that the setup changed", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);

    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "25:00");
    await user.click(screen.getByRole("button", { name: "Calculate" })); // new pace: A is now due at 5:00
    await openPacer(user);
    await showLive(user);

    expect(screen.getByRole("alert")).toHaveTextContent("The race or locations have changed since this session started");
    expect(screen.getByText("4:00.00")).toBeInTheDocument(); // still the ORIGINAL target for A, not 5:00.00
    expect(screen.queryByText("5:00.00")).not.toBeInTheDocument();

    advance(138_500);
    await record(user);
    expect(recs()[0]).toMatchObject({ target: "4:00.00", actual: "3:58.50", diff: "-1.50s", status: "AHEAD" });
  });

  it("only after resetting does a new session pick up the changed setup", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await openCalculator(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "25:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await openPacer(user);
    await showLive(user);
    await user.click(button("Reset"));
    await user.click(button("Yes, reset session"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("5:00.00")).toBeInTheDocument(); // A's new target
  });

  it("is not flagged when nothing has changed, including after leaving and returning", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await openCalculator(user);
    await openPacer(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the session survives the calculator being reset: it keeps going with its own copy", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(100_000);
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));
    await openPacer(user);
    // no race and no locations in the calculator any more, but the session is alive
    await showLive(user);
    expect(phaseLabel()).toHaveTextContent("Running");
    expect(screen.getByRole("alert")).toHaveTextContent("have changed");
    advance(138_500);
    await record(user);
    expect(recs()[0]).toMatchObject({ name: "A", target: "4:00.00", actual: "3:58.50" });
  });

  it("with a running session but no race, the Locations view explains instead of crashing", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    await openCalculator(user);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));
    await openPacer(user);
    await showLocations(user);
    expect(screen.getByText(/Calculate a race in the Calculator/)).toBeInTheDocument();
  });
});

describe("starting is blocked when the targets can't be trusted", () => {
  it("inputs changed since the race was calculated: Start is disabled, with a way to fix it", async () => {
    const user = setup();
    await calculate(user);
    await typeInto(user, screen.getByLabelText("Expected completion time"), "19:00"); // not recalculated
    await openPacer(user);
    await showLive(user);
    expect(button("Start")).toBeDisabled();
    expect(screen.getByText(/calculator inputs have changed/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to calculator" }));
    expect(screen.getByRole("form", { name: "Race calculator" })).toBeInTheDocument();
  });

  it("a location that no longer fits the race: Start is disabled and says which to fix", async () => {
    const user = setup();
    await calculate(user);
    await openPacer(user);
    await addLocation(user, "Far", "4000");
    await openCalculator(user);
    await calculate(user, "3", "15:00");
    await openPacer(user);
    await showLive(user);
    expect(button("Start")).toBeDisabled();
    expect(screen.getByText(/1 pacing location doesn't fit/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to locations" }));
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
  });

  it("Pacer Mode without a race and without a session still shows the explanation", async () => {
    const user = setup();
    await openPacer(user);
    expect(screen.getByText(/Calculate a race in the Calculator/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Live Pacer" })).not.toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("the stopwatch keeps running while you look at the calculator, and the nav says so", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(10_000);
    await openCalculator(user);
    advance(20_000);
    expect(screen.getByRole("button", { name: "Pacer Mode (live session in progress)" })).toBeInTheDocument();
    await openPacer(user);
    advance(5_000);
    await user.click(button("Pause"));
    expect(stopwatch()).toHaveTextContent("00:35.00");
  });

  it("returns to the same view", async () => {
    const user = setup();
    await liveWithAB(user);
    await openCalculator(user);
    await openPacer(user);
    expect(screen.getByRole("button", { name: "Live Pacer" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("accessibility", () => {
  it("every control has an accessible name, and the stopwatch is a labelled timer", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    for (const btn of screen.getAllByRole("button")) expect(btn).toHaveAccessibleName();
    expect(stopwatch()).toBeInTheDocument();
  });

  it("status is conveyed in words: the screen-reader announcement and the sign-and-word badge", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    expect(screen.getByText("Stopwatch started.")).toBeInTheDocument();
    advance(238_500);
    await record(user);
    expect(screen.getByText("A: 3:58.50, 1.50 seconds ahead.")).toBeInTheDocument();
    expect(within(recordedList() as HTMLElement).getByText("AHEAD")).toBeInTheDocument();
    expect(within(recordedList() as HTMLElement).getByText(/1\.50 seconds ahead/)).toBeInTheDocument();
    await user.click(button("Pause"));
    expect(screen.getByText("Paused at 03:58.50.")).toBeInTheDocument();
  });

  it("the live clock itself is not a live region, so it doesn't spam screen readers", async () => {
    const user = setup();
    await liveWithAB(user);
    await start(user);
    expect(stopwatch().closest("[aria-live]")).toBeNull();
    expect(stopwatch()).not.toHaveAttribute("aria-live", "polite");
    expect(stopwatch()).not.toHaveAttribute("aria-live", "assertive");
  });

  it("is fully operable from the keyboard", async () => {
    const user = setup();
    await liveWithAB(user);
    button("Start").focus();
    await user.keyboard("{Enter}");
    advance(238_500);
    button("Record Passing Time").focus();
    await user.keyboard(" ");
    expect(recs()).toHaveLength(1);
    button("Reset").focus();
    await user.keyboard("{Enter}");
    expect(button("Keep session")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(recs()).toHaveLength(1);
  });

  it("makes no network requests", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup();
    await liveWithAB(user);
    await start(user);
    advance(238_500);
    await record(user);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("act() sanity: the app works with the real default clock too", async () => {
    render(<App />);
    const user = userEvent.setup();
    await calculate(user);
    await openPacer(user);
    await showLive(user);
    await start(user);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await user.click(button("Pause"));
    const shown = stopwatch().textContent ?? "";
    expect(shown).toMatch(/^00:00\.\d\d$/);
    expect(shown).not.toBe("00:00.00");
  });
});
