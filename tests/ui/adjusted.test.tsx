// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { AdjustedPaceCard } from "../../src/components/AdjustedPaceCard";
import { COURSES } from "../../src/courses";
import { calculateRace, type RaceCalculation } from "../../src/engine";
import { describeDifference, formatPacePerMile, formatSigned, formatSpan } from "../../src/adjust/format";
import "./setup";

vi.mock("../../src/components/CourseMap", () => ({ CourseMap: () => <div data-testid="map-stub" /> }));

const jhp = COURSES.find((c) => c.id === "john-hunt-park")!;

function race(distance: number, seconds: number): RaceCalculation {
  const r = calculateRace({ totalDistanceMeters: distance, targetTimeSeconds: seconds, intervalMode: "automatic" });
  if (!r.ok) throw new Error("bad test race");
  return r.value;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("formatting helpers", () => {
  it("formats pace per mile and spans of time", () => {
    expect(formatPacePerMile(386.243)).toBe("6:26 /mi");
    expect(formatPacePerMile(398.492)).toBe("6:38 /mi");
    expect(formatSpan(1)).toBe("1 second");
    expect(formatSpan(38.058)).toBe("38 seconds");
    expect(formatSpan(-38.4)).toBe("38 seconds");
    expect(formatSpan(59.6)).toBe("1 min"); // rounds once, never "60 seconds"
    expect(formatSpan(65)).toBe("1 min 5 s");
  });

  it("describes the difference in plain words", () => {
    expect(describeDifference(38.058, 1200)).toBe("About 38 seconds slower than the flat target (3.2%).");
    expect(describeDifference(-12, 600)).toBe("About 12 seconds faster than the flat target (2.0%).");
    expect(describeDifference(0.3, 600)).toBe("About the same as the flat target.");
    expect(describeDifference(-0.3, 600)).toBe("About the same as the flat target.");
  });

  it("signs table differences", () => {
    expect(formatSigned(13.187)).toBe("+13 s");
    expect(formatSigned(-4.4)).toBe("-4 s");
    expect(formatSigned(0.2)).toBe("0 s");
  });
});

describe("AdjustedPaceCard", () => {
  it("with no calculated race, says to calculate one and offers the calculator", async () => {
    const onOpen = vi.fn();
    render(<AdjustedPaceCard course={jhp} race={null} onOpenCalculator={onOpen} />);
    expect(screen.getByText(/Calculate a race first/)).toBeInTheDocument();
    expect(screen.queryByTestId("estimated-pace")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Go to the calculator" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("for a race of a different length, explains why there is no estimate and shows no numbers", () => {
    render(<AdjustedPaceCard course={jhp} race={race(10000, 2400)} />);
    expect(screen.getByTestId("estimate-mismatch")).toHaveTextContent("This course is 3.13 mi long and your race is 6.21 mi");
    expect(screen.queryByTestId("estimated-pace")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  describe("a 20:00 5K on John Hunt Park", () => {
    beforeEach(() => {
      render(<AdjustedPaceCard course={jhp} race={race(5000, 1200)} />);
    });

    it("is labelled as an estimate, in the heading and the text", () => {
      expect(screen.getByRole("heading", { name: /Estimated pace on this course/ })).toHaveTextContent("Estimate");
      expect(screen.getByText(/It is an\s+estimate, not a prediction/)).toBeInTheDocument();
    });

    it("keeps the original target pace and finish visible next to the estimated pace", () => {
      expect(screen.getByTestId("original-pace")).toHaveTextContent("6:26 /mi");
      expect(screen.getByText("Finish 20:00.0")).toBeInTheDocument();
      expect(screen.getByTestId("estimated-pace")).toHaveTextContent("6:38 /mi");
      expect(screen.getByText("Finish about 20:38")).toBeInTheDocument();
      expect(screen.getByTestId("estimate-difference")).toHaveTextContent("About 38 seconds slower than the flat target (3.2%).");
    });

    it("shows projected splits in their own table, with the engine's flat target beside each estimate", () => {
      const table = screen.getByRole("table");
      const rows = within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => {
          const cells = Array.from(row.children);
          return [cells[0]!.textContent, cells[1]!.textContent, cells[2]!.querySelector(".estimate-time")!.textContent, cells[2]!.querySelector(".estimate-leg")!.textContent];
        });
      expect(rows).toEqual([
        ["1 mile", "6:26.2", "≈ 6:39", "6:39 /mi"],
        ["2 miles", "12:52.5", "≈ 13:23", "6:44 /mi"],
        ["3 miles", "19:18.7", "≈ 19:58", "6:35 /mi"],
        ["5000 mFinish", "20:00.0", "≈ 20:38", "6:14 /mi"],
      ]);
      expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Distance", "Flat target", "Estimate"]);
    });

    it("has a collapsed explanation of the method and its limits, in plain words", async () => {
      const details = screen.getByText(/How this estimate works/).closest("details")!;
      expect(details).not.toHaveAttribute("open");
      await userEvent.click(within(details).getByText(/How this estimate works/));
      expect(details).toHaveAttribute("open");
      expect(details).toHaveTextContent("3.4% slower for each 1%");
      expect(details).toHaveTextContent("surface, turns, wind or heat");
      expect(details).toHaveTextContent("About 5% of the route");
    });
  });

  it("warns when the race was edited after it was calculated", () => {
    render(<AdjustedPaceCard course={jhp} race={race(5000, 1200)} raceIsStale />);
    expect(screen.getByRole("status")).toHaveTextContent("This uses the last calculated race.");
  });
});

describe("in the whole app", () => {
  it("uses the race calculated in Race Pacer, without changing it, and links back to the calculator", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    const before = within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent);

    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    expect(screen.getByTestId("estimated-pace")).toHaveTextContent("6:38 /mi");
    expect(screen.getByTestId("original-pace")).toHaveTextContent("6:26 /mi");

    await user.click(screen.getByRole("button", { name: "Race Pacer" }));
    expect(within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent)).toEqual(before);
    expect(screen.getByLabelText("Expected completion time")).toHaveValue("20:00");
  });

  it("before any calculation, the card offers a button that opens the calculator", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    await user.click(screen.getByRole("button", { name: "Go to the calculator" }));
    expect(screen.getByLabelText("Distance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Race Pacer" })).toHaveAttribute("aria-current", "page");
  });

  it("recalculating in Race Pacer changes the estimate", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    expect(screen.getByText("Finish about 20:38")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Race Pacer" }));
    await user.clear(screen.getByLabelText("Expected completion time"));
    await user.type(screen.getByLabelText("Expected completion time"), "25:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    // 25:00 flat x the same hill effect (1238.058 / 1200 = 1.031715...) = 1547.57 s = 25:48.
    expect(screen.getByText("Finish about 25:48")).toBeInTheDocument();
  });
});
