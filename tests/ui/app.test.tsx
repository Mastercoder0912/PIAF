// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import "./setup";

type User = ReturnType<typeof userEvent.setup>;

function setup(): User {
  render(<App />);
  return userEvent.setup();
}

const distanceBox = () => screen.getByLabelText("Distance");
const timeBox = () => screen.getByLabelText("Expected completion time");
const paceBox = () => screen.getByLabelText("Pace per mile");
const intervalBox = () => screen.getByLabelText("Interval distance");
const calculateButton = () => screen.getByRole("button", { name: "Calculate" });
const resetButton = () => screen.getByRole("button", { name: "Reset" });

async function pickUnit(user: User, group: "Distance unit" | "Interval unit", name: string) {
  await user.click(within(screen.getByRole("group", { name: group })).getByLabelText(name));
}

async function typeInto(user: User, box: HTMLElement, text: string) {
  await user.clear(box);
  if (text) await user.type(box, text);
}

/** Rows of the split table as [number, distance, time] text. */
function tableRows(): string[][] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ""));
}

function summaryValue(label: RegExp): string {
  const term = screen.getAllByText(label).find((el) => el.tagName === "DT");
  if (!term) throw new Error(`No summary stat matching ${label}`);
  return term.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("initial state", () => {
  it("starts empty with Target Time and Automatic selected, and no results", () => {
    setup();
    expect(distanceBox()).toHaveValue("");
    expect(screen.getByLabelText("Target Time")).toBeChecked();
    expect(screen.getByLabelText("Automatic")).toBeChecked();
    expect(screen.getByLabelText("Kilometers")).toBeChecked();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/press/i, { selector: "p" })).toHaveTextContent("Calculate");
  });

  it("makes no network requests (no fetch / XHR / WebSocket used by the app)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("5K in 20:00", () => {
  it("shows the calculated pace and the automatic split table (mile markers plus finish)", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());

    expect(summaryValue(/^Mile pace/)).toBe("6:26.2 /mi");
    expect(summaryValue(/^Completion time/)).toBe("20:00.0");
    expect(summaryValue(/^Distance/)).toBe("5000 m");

    const rows = tableRows();
    expect(rows).toEqual([
      ["1", "1 mile", "6:26.2"],
      ["2", "2 miles", "12:52.5"],
      ["3", "3 miles", "19:18.7"],
      ["4", "5000 mFinish", "20:00.0"],
    ]);
  });

  it("marks the finish row distinctly", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    const finishRows = within(screen.getByRole("table")).getAllByRole("row").filter((r) => r.classList.contains("finish-row"));
    expect(finishRows).toHaveLength(1);
    expect(within(finishRows[0] as HTMLElement).getByText("Finish")).toBeInTheDocument();
  });

  it("submits with the Enter key", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await user.type(timeBox(), "20:00{Enter}");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("5K at 7:00/mile", () => {
  it("shows the calculated completion time", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "7:00");
    await user.click(calculateButton());

    expect(summaryValue(/^Completion time/)).toBe("21:44.9");
    expect(summaryValue(/^Mile pace/)).toBe("7:00.0 /mi");
    const rows = tableRows();
    expect(rows[0]).toEqual(["1", "1 mile", "7:00.0"]);
    expect(rows.at(-1)).toEqual(["4", "5000 mFinish", "21:44.9"]);
  });

  it("labels which value was calculated", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "7:00");
    await user.click(calculateButton());
    const time = screen.getAllByText(/^Completion time/).find((el) => el.tagName === "DT");
    expect(within(time as HTMLElement).getByText("calculated")).toBeInTheDocument();
  });
});

describe("1600 m versus one mile", () => {
  it("1600 m ends at 1600 m (5:57.9 at 6:00/mile) with no mile row", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "1600");
    await pickUnit(user, "Distance unit", "Meters");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "6:00");
    await user.click(calculateButton());

    const rows = tableRows();
    expect(rows).toHaveLength(8);
    expect(rows.at(-1)).toEqual(["8", "1600 mFinish", "5:57.9"]);
    expect(rows.some((r) => r[1] === "1 mile")).toBe(false);
  });

  it("1 mile uses 400 m splits and ends at the mile (6:00.0), with no 1600 m row", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "1");
    await pickUnit(user, "Distance unit", "Miles");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "6:00");
    await user.click(calculateButton());

    const rows = tableRows();
    // expected times: 400/800/1200 m at 6:00 per mile = 89.477 s, 178.955 s, 268.432 s
    expect(rows).toEqual([
      ["1", "400 m", "1:29.5"],
      ["2", "800 m", "2:59.0"],
      ["3", "1200 m", "4:28.4"],
      ["4", "1 mileFinish", "6:00.0"],
    ]);
    expect(summaryValue(/^Distance/)).toBe("1 mile");
  });
});

describe("manual intervals", () => {
  async function fiveK(user: User) {
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
  }

  it("400 m on a 5K gives 12 markers plus the finish", async () => {
    const user = setup();
    await fiveK(user);
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "400");
    await user.click(calculateButton());

    const rows = tableRows();
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual(["1", "400 m", "1:36.0"]);
    expect(rows[1]?.[1]).toBe("800 m");
    expect(rows.at(-1)).toEqual(["13", "5000 mFinish", "20:00.0"]);
  });

  it("a quick-pick chip fills the interval and unit", async () => {
    const user = setup();
    await fiveK(user);
    await user.click(screen.getByLabelText("Manual"));
    await user.click(screen.getByRole("button", { name: "1 mile" }));
    expect(intervalBox()).toHaveValue("1");
    expect(within(screen.getByRole("group", { name: "Interval unit" })).getByLabelText("Miles")).toBeChecked();
    await user.click(calculateButton());
    expect(tableRows().map((r) => r[1])).toEqual(["1 mile", "2 miles", "3 miles", "5000 mFinish"]);
  });

  it("converts a kilometer interval", async () => {
    const user = setup();
    await fiveK(user);
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "2");
    await pickUnit(user, "Interval unit", "Kilometers");
    await user.click(calculateButton());
    expect(tableRows().map((r) => r[1])).toEqual(["2000 m", "4000 m", "5000 mFinish"]);
  });

  it("a distance that isn't divisible by the interval still ends with the finish", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "1000");
    await pickUnit(user, "Distance unit", "Meters");
    await typeInto(user, timeBox(), "3:00");
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "333");
    await user.click(calculateButton());
    expect(tableRows().map((r) => r[1])).toEqual(["333 m", "666 m", "999 m", "1000 mFinish"]);
  });

  it("switching back to Automatic uses the automatic generator again", async () => {
    const user = setup();
    await fiveK(user);
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "400");
    await user.click(screen.getByLabelText("Automatic"));
    await user.click(calculateButton());
    expect(tableRows().map((r) => r[1])).toEqual(["1 mile", "2 miles", "3 miles", "5000 mFinish"]);
  });
});

describe("changing between target time and target pace", () => {
  it("carries the equivalent value across, shows a 'converted' note, and keeps the original", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");

    await user.click(screen.getByLabelText("Target Pace"));
    expect(paceBox()).toHaveValue("6:26.243");
    expect(screen.getByText(/Converted from your time/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Expected completion time")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Target Time"));
    expect(timeBox()).toHaveValue("20:00");
  });

  it("calculates correctly from a converted value", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(screen.getByLabelText("Target Pace"));
    await user.click(calculateButton());
    expect(summaryValue(/^Completion time/)).toBe("20:00.0");
  });

  it("with nothing to convert, switching just changes the visible input", async () => {
    const user = setup();
    await user.click(screen.getByLabelText("Target Pace"));
    expect(paceBox()).toHaveValue("");
    expect(screen.queryByText(/Converted from/)).not.toBeInTheDocument();
  });

  it("clears the old error when the mode changes", async () => {
    const user = setup();
    await user.click(calculateButton());
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    await user.click(screen.getByLabelText("Target Pace"));
    expect(screen.queryByText(/MM:SS or HH:MM:SS/, { selector: ".field-error p" })).not.toBeInTheDocument();
  });
});

describe("invalid input", () => {
  it("shows a red message on each bad field and focuses the first one", async () => {
    const user = setup();
    await user.click(calculateButton());

    const distanceError = screen.getByText("Enter a race distance.");
    expect(distanceError).toBeInTheDocument();
    expect(distanceBox()).toHaveAttribute("aria-invalid", "true");
    expect(distanceBox()).toHaveFocus();
    expect(timeBox()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("rejects 60 seconds and explains why", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:60");
    await user.click(calculateButton());
    expect(screen.getByText(/Seconds must be less than 60/)).toBeInTheDocument();
    expect(timeBox()).toHaveFocus();
  });

  it("rejects a zero distance with the engine's message", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "0");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    expect(screen.getByText("Distance must be a number greater than 0.")).toBeInTheDocument();
  });

  it("rejects an invalid pace", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "7:75");
    await user.click(calculateButton());
    expect(screen.getByText(/less than 60/)).toBeInTheDocument();
    expect(paceBox()).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a manual interval of zero", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "0");
    await user.click(calculateButton());
    expect(screen.getByText(/Custom interval must be a number of meters greater than 0/)).toBeInTheDocument();
    expect(intervalBox()).toHaveFocus();
  });

  it("clears a field's error as soon as the coach edits that field", async () => {
    const user = setup();
    await user.click(calculateButton());
    await user.type(distanceBox(), "5");
    expect(screen.queryByText("Enter a race distance.")).not.toBeInTheDocument();
    expect(distanceBox()).not.toHaveAttribute("aria-invalid");
  });

  it("removes old results when a later calculation fails, so stale numbers never stay on screen", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    expect(screen.getByRole("table")).toBeInTheDocument();

    await typeInto(user, timeBox(), "20:99");
    await user.click(calculateButton());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("stale results", () => {
  it("dims results and says so when inputs change after calculating, and clears the note on recalculation", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    expect(screen.queryByText(/Inputs changed since/)).not.toBeInTheDocument();

    await typeInto(user, timeBox(), "19:00");
    expect(screen.getByText(/Inputs changed since/)).toBeInTheDocument();

    await user.click(calculateButton());
    expect(screen.queryByText(/Inputs changed since/)).not.toBeInTheDocument();
    expect(summaryValue(/^Completion time/)).toBe("19:00.0");
  });

  it("flipping the mode and back is not treated as a change", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    await user.click(screen.getByLabelText("Target Pace"));
    await user.click(screen.getByLabelText("Target Time"));
    expect(screen.queryByText(/Inputs changed since/)).not.toBeInTheDocument();
  });
});

describe("reset", () => {
  it("resets immediately, with no prompt, when nothing has been entered", async () => {
    const user = setup();
    await user.click(screen.getByLabelText("Miles"));
    await user.click(resetButton());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Kilometers")).toBeChecked();
  });

  it("asks for confirmation when values have been entered, and 'Keep editing' changes nothing", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    await user.click(resetButton());

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(distanceBox()).toHaveValue("5");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("confirming clears the form, the results and any errors, and restores every default", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await pickUnit(user, "Distance unit", "Miles");
    await user.click(screen.getByLabelText("Target Pace"));
    await typeInto(user, paceBox(), "7:00");
    await user.click(screen.getByLabelText("Manual"));
    await typeInto(user, intervalBox(), "400");
    await user.click(calculateButton());
    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.click(resetButton());
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(distanceBox()).toHaveValue("");
    expect(screen.getByLabelText("Kilometers")).toBeChecked();
    expect(screen.getByLabelText("Target Time")).toBeChecked();
    expect(timeBox()).toHaveValue("");
    expect(screen.getByLabelText("Automatic")).toBeChecked();
    expect(screen.queryByLabelText("Interval distance")).not.toBeInTheDocument();

    // Pace and interval text must be gone too, not just hidden.
    await user.click(screen.getByLabelText("Target Pace"));
    expect(paceBox()).toHaveValue("");
    await user.click(screen.getByLabelText("Manual"));
    expect(intervalBox()).toHaveValue("");
  });

  it("clears validation errors", async () => {
    const user = setup();
    await user.click(calculateButton());
    expect(screen.getByText("Enter a race distance.")).toBeInTheDocument();
    await user.click(resetButton());
    expect(screen.queryByText("Enter a race distance.")).not.toBeInTheDocument();
  });

  it("Escape dismisses the confirmation", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await user.click(resetButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(distanceBox()).toHaveValue("5");
  });
});

describe("Pacer Mode navigation", () => {
  // Phase 3 replaced the "coming soon" placeholder with the real Pacer Mode screen, so this test now
  // checks the functional screen. Its original purpose (navigating away and back loses no work) is unchanged.
  it("opens the Pacer Mode screen (no longer a placeholder) and returns without losing work", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());

    await user.click(screen.getByRole("button", { name: "Pacer Mode" }));
    expect(screen.getByRole("heading", { name: "Active race" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pacing locations" })).toBeInTheDocument();
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pacer Mode" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Calculator" }));
    expect(distanceBox()).toHaveValue("5");
    expect(timeBox()).toHaveValue("20:00");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("accessibility basics", () => {
  it("every input has an accessible name and the table has headers", async () => {
    const user = setup();
    await typeInto(user, distanceBox(), "5");
    await typeInto(user, timeBox(), "20:00");
    await user.click(calculateButton());
    for (const input of screen.getAllByRole("textbox")) {
      expect(input).toHaveAccessibleName();
    }
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["#", "Distance", "Target time"]);
  });
});
