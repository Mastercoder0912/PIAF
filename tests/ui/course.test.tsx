// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { COURSES } from "../../src/courses";
import { CourseExplorerScreen } from "../../src/screens/CourseExplorerScreen";
import type { CourseData } from "../../src/courses/types";
import { tinyCourse } from "../courses/helpers";
import "./setup";

// The real map needs a browser (it measures its own box). Here it is replaced by a stand-in that shows exactly what
// the screen told it, so these tests can check that the map is given the right position. The real map is
// exercised in a real browser (see the Course Explorer verification notes).
vi.mock("../../src/components/CourseMap", () => ({
  CourseMap: ({ course, position }: { course: CourseData; position: { lat: number; lon: number; inGap: boolean } }) => (
    <div data-testid="map-stub" data-course={course.id} data-lat={position.lat} data-lon={position.lon} data-ingap={String(position.inGap)} />
  ),
}));

type User = ReturnType<typeof userEvent.setup>;

const jhp = COURSES.find((c) => c.id === "john-hunt-park")!;

let now = 0;
const clock = () => now;
beforeEach(() => {
  now = 5_000;
  Element.prototype.scrollIntoView = vi.fn();
});

const slider = () => screen.getByLabelText("Position along the course") as HTMLInputElement;
const moveSlider = (meters: number) => fireEvent.change(slider(), { target: { value: String(meters) } });
const readout = (name: "distance" | "elevation") => screen.getByTestId(`readout-${name}`);
const map = () => screen.getByTestId("map-stub");
const cursor = () => screen.getByTestId("profile-cursor");
const dot = () => screen.getByTestId("profile-dot");
const svg = () => screen.getByRole("img", { name: /Elevation profile/ });

// Profile geometry in jsdom (no layout, so the 340 px fallback width): plot x runs from 46 to 340 - 14 = 326.
const PLOT_LEFT = 46;
const PLOT_WIDTH = 280;

/** Linear interpolation by scanning the supplied points: an independent re-derivation of what the screen should show. */
function expectedAt(meters: number) {
  const pts = jhp.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (meters >= a[3] && meters <= b[3] && b[3] > a[3]) {
      const t = (meters - a[3]) / (b[3] - a[3]);
      return { lat: a[0] + t * (b[0] - a[0]), lon: a[1] + t * (b[1] - a[1]), ele: a[2] + t * (b[2] - a[2]) };
    }
  }
  throw new Error(`no segment for ${meters}`);
}

describe("navigation: Race Pacer and Explore a Course", () => {
  it("offers the two modes, starting in Race Pacer with the existing calculator", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("button", { name: "Race Pacer" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Explore a Course" })).not.toHaveAttribute("aria-current");
    expect(screen.getByLabelText("Distance")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("switches to the course screen, which is separate: no calculator, no Calculator/Pacer Mode tabs", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    expect(screen.getByRole("heading", { name: "John Hunt Park" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Distance")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore a Course" })).toHaveAttribute("aria-current", "page");
  });

  it("coming back to Race Pacer finds the calculator exactly as it was left", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    await user.click(screen.getByRole("button", { name: "Race Pacer" }));

    expect(screen.getByLabelText("Distance")).toHaveValue("5");
    expect(screen.getByLabelText("Expected completion time")).toHaveValue("20:00");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("returns to the screen that was open (Pacer Mode), with its locations intact", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await user.click(screen.getByRole("button", { name: /^Pacer Mode/ }));
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    expect(screen.getByText("1 mile")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    await user.click(screen.getByRole("button", { name: "Race Pacer" }));

    expect(screen.getByRole("button", { name: /^Pacer Mode/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("1 mile")).toBeInTheDocument();
  });

  it("a live session keeps running while exploring, and a banner leads straight back to it", async () => {
    render(<App clock={clock} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await user.click(screen.getByRole("button", { name: /^Pacer Mode/ }));
    await user.click(screen.getByRole("button", { name: "Live Pacer" }));
    await user.click(screen.getByRole("button", { name: "Start" }));

    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    // The mode button shows a live indicator, and the banner is there.
    expect(screen.getByRole("button", { name: /Race Pacer.*live session in progress/ })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/live pacing session is still running/);

    now += 10_000; // ten seconds pass while looking at the course
    await user.click(screen.getByRole("button", { name: "Back to the live pacer" }));
    expect(document.querySelector(".live-phase")).toHaveTextContent("Running");
    await waitFor(() => expect(screen.getByRole("timer", { name: "Elapsed time" })).toHaveTextContent(/0:10/));
  });

  it("shows no banner when no session is running", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explore a Course" }));
    expect(screen.queryByText(/live pacing session/)).not.toBeInTheDocument();
  });
});

describe("the John Hunt Park course screen", () => {
  it("describes the course and what it is", () => {
    render(<CourseExplorerScreen />);
    expect(screen.getByRole("heading", { name: "John Hunt Park" })).toBeInTheDocument();
    expect(screen.getByText("Huntsville, Alabama")).toBeInTheDocument();
    expect(screen.getByText(/recorded with a Garmin watch/)).toBeInTheDocument();
    expect(screen.getByText(/not a measured or official race course/)).toBeInTheDocument();
  });

  it("shows total distance and elevation information from the data", () => {
    render(<CourseExplorerScreen />);
    const facts = within(screen.getByRole("region", { name: "About this route" }));
    const valueOf = (label: string) => facts.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
    expect(valueOf("Total distance")).toBe("3.13 mi (5.03 km)");
    expect(valueOf("Elevation gain")).toBe("251 ft (77 m)");
    expect(valueOf("Elevation loss")).toBe("310 ft (95 m)");
    expect(valueOf("Highest point")).toBe("677 ft (206.2 m)");
    expect(valueOf("Lowest point")).toBe("600 ft (183.0 m)");
  });

  it("tells the coach about the recording gap, that gain/loss are estimates, and where the data came from", () => {
    render(<CourseExplorerScreen />);
    const facts = screen.getByRole("region", { name: "About this route" });
    expect(facts).toHaveTextContent("Nothing was recorded for 167 m (about 41 seconds) between mile 0.44 and mile 0.54");
    expect(facts).toHaveTextContent(/Gain and loss: .*An estimate from a watch's elevation sensor/);
    expect(facts).toHaveTextContent("Source: Garmin recording from October 17, 2026, 1190 recorded points.");
  });

  it("explains the dashed line on the map", () => {
    render(<CourseExplorerScreen />);
    expect(screen.getByText(/Dashed: nothing was recorded here/)).toBeInTheDocument();
  });

  it("offers no course picker when there is only one course", () => {
    render(<CourseExplorerScreen />);
    expect(screen.queryByLabelText("Course")).not.toBeInTheDocument();
  });
});

describe("synchronisation: slider, readouts, map and profile are one position", () => {
  it("starts at the beginning of the course, with everything agreeing", () => {
    render(<CourseExplorerScreen />);
    expect(slider()).toHaveValue("0");
    expect(readout("distance")).toHaveTextContent("0.00 mi 0.00 km");
    expect(readout("elevation")).toHaveTextContent("669 ft 203.8 m");
    expect(Number(map().dataset.lat)).toBeCloseTo(34.684907, 6);
    expect(Number(map().dataset.lon)).toBeCloseTo(-86.587065, 6);
    expect(Number(cursor().getAttribute("x1"))).toBeCloseTo(PLOT_LEFT, 6);
  });

  it.each([250, 1000, 1500, 2516, 4000])("at %i m the distance, elevation, map marker and chart cursor all match the data", (meters) => {
    render(<CourseExplorerScreen />);
    moveSlider(meters);
    const expected = expectedAt(meters);

    expect(readout("distance")).toHaveTextContent(`${(meters / 1609.344).toFixed(2)} mi ${(meters / 1000).toFixed(2)} km`);
    expect(readout("elevation")).toHaveTextContent(`${Math.round(expected.ele * 3.280839895)} ft ${expected.ele.toFixed(1)} m`);
    expect(Number(map().dataset.lat)).toBeCloseTo(expected.lat, 9);
    expect(Number(map().dataset.lon)).toBeCloseTo(expected.lon, 9);
    expect(Number(cursor().getAttribute("x1"))).toBeCloseTo(PLOT_LEFT + (meters / jhp.distanceMeters) * PLOT_WIDTH, 6);
    expect(Number(dot().getAttribute("cx"))).toBeCloseTo(PLOT_LEFT + (meters / jhp.distanceMeters) * PLOT_WIDTH, 6);
  });

  it("the chart dot rides the elevation line: higher ground is higher on screen", () => {
    render(<CourseExplorerScreen />);
    moveSlider(700); // near the 206 m high point
    const high = Number(dot().getAttribute("cy"));
    moveSlider(1400); // near the 184 m low
    const low = Number(dot().getAttribute("cy"));
    expect(high).toBeLessThan(low); // smaller y is higher up
  });

  it("reaches the very end: the slider's last stop is the full course distance, at the last recorded point", () => {
    render(<CourseExplorerScreen />);
    expect(slider()).toHaveAttribute("max", "5035"); // 5033.7 m rounded up to the next 5 m step
    moveSlider(5035);
    expect(readout("distance")).toHaveTextContent("3.13 mi 5.03 km");
    const last = jhp.points[jhp.points.length - 1]!;
    expect(Number(map().dataset.lat)).toBeCloseTo(last[0], 9);
    expect(Number(map().dataset.lon)).toBeCloseTo(last[1], 9);
    expect(readout("elevation")).toHaveTextContent("610 ft 185.8 m");
    expect(Number(cursor().getAttribute("x1"))).toBeCloseTo(PLOT_LEFT + PLOT_WIDTH, 6);
  });

  it("goes back to the start", () => {
    render(<CourseExplorerScreen />);
    moveSlider(3000);
    moveSlider(0);
    expect(readout("distance")).toHaveTextContent("0.00 mi");
    expect(Number(map().dataset.lat)).toBeCloseTo(34.684907, 6);
  });

  it("the slider announces the same thing the readouts show", () => {
    render(<CourseExplorerScreen />);
    moveSlider(1000);
    expect(slider()).toHaveAttribute("aria-valuetext", expect.stringMatching(/^0\.62 mi \(1\.00 km\), elevation \d+ ft \(\d+\.\d m\)$/));
    expect(svg()).toHaveAccessibleName(/Cursor at 0\.62 mi \(1\.00 km\)/);
  });

  it("touching or dragging the chart moves everything else, in step", () => {
    render(<CourseExplorerScreen />);
    // jsdom does no layout, so the chart's left edge is x = 0 and a touch at x = 186 is halfway along the plot (46 + 140).
    fireEvent(svg(), new MouseEvent("pointerdown", { clientX: PLOT_LEFT + PLOT_WIDTH / 2, bubbles: true }));
    const half = jhp.distanceMeters / 2;
    expect(readout("distance")).toHaveTextContent(`${(half / 1609.344).toFixed(2)} mi ${(half / 1000).toFixed(2)} km`);
    expect(slider()).toHaveValue(String(Math.round(half / 5) * 5));
    const expected = expectedAt(half);
    expect(Number(map().dataset.lat)).toBeCloseTo(expected.lat, 9);

    // Drag on to a quarter of the way
    fireEvent(svg(), new MouseEvent("pointermove", { clientX: PLOT_LEFT + PLOT_WIDTH / 4, bubbles: true }));
    expect(slider()).toHaveValue(String(Math.round(jhp.distanceMeters / 4 / 5) * 5));
    expect(Number(map().dataset.lat)).toBeCloseTo(expectedAt(jhp.distanceMeters / 4).lat, 9);
  });

  it("moves are ignored after the finger lifts, and a drag past either end stops at the ends", () => {
    render(<CourseExplorerScreen />);
    fireEvent(svg(), new MouseEvent("pointerdown", { clientX: PLOT_LEFT + 100, bubbles: true }));
    fireEvent(svg(), new MouseEvent("pointerup", { bubbles: true }));
    const before = slider().value;
    fireEvent(svg(), new MouseEvent("pointermove", { clientX: PLOT_LEFT + 200, bubbles: true }));
    expect(slider().value).toBe(before); // not dragging any more

    fireEvent(svg(), new MouseEvent("pointerdown", { clientX: -500, bubbles: true }));
    expect(readout("distance")).toHaveTextContent("0.00 mi");
    fireEvent(svg(), new MouseEvent("pointermove", { clientX: 5000, bubbles: true }));
    expect(readout("distance")).toHaveTextContent("3.13 mi 5.03 km");
  });

  it("a cancelled touch (the page started scrolling) stops the drag", () => {
    render(<CourseExplorerScreen />);
    fireEvent(svg(), new MouseEvent("pointerdown", { clientX: PLOT_LEFT + 50, bubbles: true }));
    fireEvent(svg(), new MouseEvent("pointercancel", { bubbles: true }));
    const before = slider().value;
    fireEvent(svg(), new MouseEvent("pointermove", { clientX: PLOT_LEFT + 250, bubbles: true }));
    expect(slider().value).toBe(before);
  });
});

describe("the recording gap", () => {
  it("says the position is an estimate inside the gap, flags the map and the chart dot, and clears outside it", () => {
    render(<CourseExplorerScreen />);
    moveSlider(800); // inside 703.9 to 871.2 m
    expect(screen.getByText(/Nothing was recorded at this spot, so the position and elevation are estimates/)).toBeInTheDocument();
    expect(map().dataset.ingap).toBe("true");
    expect(dot()).toHaveClass("is-gap");

    moveSlider(600);
    expect(screen.queryByText(/Nothing was recorded at this spot/)).not.toBeInTheDocument();
    expect(map().dataset.ingap).toBe("false");
    expect(dot()).not.toHaveClass("is-gap");
  });

  it("marks the gap on the profile at the right place", () => {
    render(<CourseExplorerScreen />);
    const band = screen.getByTestId("profile-gap");
    expect(Number(band.getAttribute("x"))).toBeCloseTo(PLOT_LEFT + (703.9 / jhp.distanceMeters) * PLOT_WIDTH, 6);
    expect(Number(band.getAttribute("width"))).toBeCloseTo(((871.2 - 703.9) / jhp.distanceMeters) * PLOT_WIDTH, 6);
  });
});

describe("more than one course", () => {
  const second: CourseData = tinyCourse({ id: "second", name: "Second Course", place: "Elsewhere", summary: "Another." });
  const courses = [jhp, second];

  it("offers a picker, and switching shows the other course starting from its beginning", async () => {
    render(<CourseExplorerScreen courses={courses} />);
    const user = userEvent.setup();
    moveSlider(3000);
    expect(map().dataset.course).toBe("john-hunt-park");

    await user.selectOptions(screen.getByLabelText("Course"), "second");
    expect(screen.getByRole("heading", { name: "Second Course" })).toBeInTheDocument();
    expect(map().dataset.course).toBe("second");
    expect(slider()).toHaveValue("0");
    expect(readout("distance")).toHaveTextContent("0.00 mi");
    expect(slider()).toHaveAttribute("max", "300");
    expect(Number(map().dataset.lat)).toBeCloseTo(10, 9);
  });

  it("works for a course with no gaps: no legend, no gap note", async () => {
    render(<CourseExplorerScreen courses={[tinyCourse({ gaps: [] })]} />);
    expect(screen.queryByText(/Dashed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing was recorded/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-gap")).not.toBeInTheDocument();
  });

  it("says so when there are no courses at all", () => {
    render(<CourseExplorerScreen courses={[]} />);
    expect(screen.getByText("No courses are available yet.")).toBeInTheDocument();
  });
});
