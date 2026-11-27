// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { CompareCoursesScreen } from "../../src/screens/CompareCoursesScreen";
import { COURSES } from "../../src/courses";
import type { CourseData } from "../../src/courses/types";
import { tinyCourse } from "../courses/helpers";
import "./setup";

vi.mock("../../src/components/CourseMap", () => ({ CourseMap: () => <div data-testid="map-stub" /> }));

const jhp = COURSES.find((c) => c.id === "john-hunt-park")!;

/** A second 5 km course for the tests: steady 2% climb (factor 1 + 0.068 + 0.0084 = 1.0764), no gaps. */
const climb: CourseData = tinyCourse({
  id: "test-climb",
  name: "Test Climb 5K",
  place: "Test",
  distanceMeters: 5000,
  gaps: [],
  elevation: { minMeters: 0, maxMeters: 100, startMeters: 0, endMeters: 100, gainMeters: 100, lossMeters: 0, method: "test" },
  points: [
    [34, -86, 0, 0],
    [34.01, -86, 100, 5000],
  ],
});
const both = [jhp, climb] as const;

async function enterTimes(user: ReturnType<typeof userEvent.setup>, times: string[]) {
  for (let i = 0; i < times.length; i++) await user.type(screen.getByLabelText(new RegExp(`^${["Start to 1 mile", "1 mile to 2 miles", "2 miles to 3 miles", "3 miles to the finish"][i]}`)), times[i]!);
}

describe("Compare Courses screen", () => {
  it("with only one course loaded, says there is nothing to compare yet", () => {
    render(<CompareCoursesScreen courses={[jhp]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Only one course is loaded so far");
  });

  it("lists the two courses to pick from, the race distance, and the four stretches of a 5K", () => {
    render(<CompareCoursesScreen courses={both} />);
    expect(screen.getByLabelText(/Old course/)).toBeInTheDocument();
    expect(screen.getByLabelText(/New course/)).toBeInTheDocument();
    expect(screen.getByLabelText("Distance")).toHaveValue("5");
    for (const label of ["Start to 1 mile", "1 mile to 2 miles", "2 miles to 3 miles", "3 miles to the finish"]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeInTheDocument();
    }
    expect(screen.queryByTestId("new-total")).toBeNull();
    expect(screen.getByTestId("entered-total")).toHaveTextContent("Enter every time to see the estimate.");
  });

  it("moves the example 5K splits from a flat-ish old course to a steady climb, by the hill ratio", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={both} />);
    await user.selectOptions(screen.getByLabelText(/Old course/), "test-climb");
    await user.selectOptions(screen.getByLabelText(/New course/), "john-hunt-park");
    await enterTimes(user, ["5:53.4", "6:10.3", "6:59.5", "0:36.1"]);

    expect(screen.getByTestId("entered-total")).toHaveTextContent("Total: 19:39.3");
    expect(screen.getByTestId("old-total")).toHaveTextContent("19:39.3");
    // Worked out separately in Python: the climb is a steady 2% (factor 1.0764); John Hunt Park's four stretches
    // have factors 1.0045, 1.0078, 1.0219 and 0.9739 (the same rule). New leg = old leg x new factor / 1.0764.
    expect(screen.getByTestId("new-total")).toHaveTextContent("about 18:27"); // 329.80 + 346.69 + 398.27 + 32.66 = 1107.42 s
    expect(screen.getByTestId("compare-difference")).toHaveTextContent("About 1 min 12 s faster on John Hunt Park than on Test Climb 5K (6.1%).");
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1).map((row) => [row.querySelector(".distance-text")!.textContent, row.querySelectorAll(".estimate-time")[0]!.textContent, row.querySelectorAll(".estimate-time")[1]!.textContent]);
    expect(rows).toEqual([
      ["Start to 1 mile", "5:53.4", "≈ 5:30"],
      ["1 mile to 2 miles", "6:10.3", "≈ 5:47"],
      ["2 miles to 3 miles", "6:59.5", "≈ 6:38"],
      ["3 miles to the finish", "0:36.1", "≈ 0:33"],
    ]);
    expect(within(table).getByText("3 miles to the finish")).toBeInTheDocument();
  });

  it("the coach's own example: a 19:39.3 Hermitage 5K moved to John Hunt Park, on the real bundled courses", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={COURSES} />);
    await user.selectOptions(screen.getByLabelText(/Old course/), "hermitage");
    await user.selectOptions(screen.getByLabelText(/New course/), "john-hunt-park");
    await enterTimes(user, ["5:53.4", "6:10.3", "6:59.5", "0:36.1"]);
    // Separate Python calculation: Hermitage leg factors 1.0405, 1.0172, 1.0184, 1.0970; John Hunt Park 1.0045, 1.0078, 1.0219, 0.9739.
    // New legs 341.19 + 366.87 + 420.96 + 32.05 = 1161.07 s = 19:21.1, which is 18.2 s (1.5%) faster than 1179.3 s.
    expect(screen.getByTestId("new-total")).toHaveTextContent("about 19:21");
    expect(screen.getByTestId("compare-difference")).toHaveTextContent("About 18 seconds faster on John Hunt Park than on Hermitage (1.5%).");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((row) => row.querySelectorAll(".estimate-time")[1]!.textContent);
    expect(rows).toEqual(["≈ 5:41", "≈ 6:07", "≈ 7:01", "≈ 0:32"]);
  });

  it("choosing the same course on both sides changes nothing", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={both} />);
    await user.selectOptions(screen.getByLabelText(/Old course/), "john-hunt-park");
    await user.selectOptions(screen.getByLabelText(/New course/), "john-hunt-park");
    await enterTimes(user, ["5:53.4", "6:10.3", "6:59.5", "0:36.1"]);
    expect(screen.getByTestId("new-total")).toHaveTextContent("about 19:39");
    expect(screen.getByTestId("compare-difference")).toHaveTextContent("About the same on John Hunt Park as on John Hunt Park.");
    expect(screen.getByText(/You picked the same course twice/)).toBeInTheDocument();
  });

  it("shows a message on a bad time and no estimate until every time is valid", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={both} />);
    await user.type(screen.getByLabelText(/^Start to 1 mile/), "abc");
    const field = screen.getByLabelText(/^Start to 1 mile/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/\d+:\d\d/); // the message shows an example time
    await user.clear(field);
    expect(field).not.toHaveAttribute("aria-invalid");
    await user.type(screen.getByLabelText(/^1 mile to 2 miles/), "6:10.3");
    expect(screen.queryByTestId("new-total")).toBeNull(); // the other three stretches are still empty
  });

  it("rejects a leg time of zero", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={both} />);
    await user.type(screen.getByLabelText(/^Start to 1 mile/), "0:00");
    expect(screen.getByLabelText(/^Start to 1 mile/)).toHaveAccessibleDescription("A leg time must be greater than 0.");
  });

  it("explains instead of guessing when the race is not as long as the courses", async () => {
    const user = userEvent.setup();
    render(<CompareCoursesScreen courses={both} />);
    await user.clear(screen.getByLabelText("Distance"));
    await user.type(screen.getByLabelText("Distance"), "10");
    expect(screen.getByTestId("compare-mismatch")).toHaveTextContent("is 3.16 mi long and your race is 6.21 mi");
    expect(screen.queryByLabelText(/^Start to/)).toBeNull();
  });

  it("draws both profiles, on one scale", () => {
    render(<CompareCoursesScreen courses={both} />);
    expect(screen.getByRole("img", { name: /Elevation profile of John Hunt Park/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Elevation profile of Test Climb 5K/ })).toBeInTheDocument();
  });
});

describe("in the whole app", () => {
  it("has a third section, Compare Courses, and leaves Race Pacer alone", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("Distance"), "5");
    await user.type(screen.getByLabelText("Expected completion time"), "20:00");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    const before = within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent);

    await user.click(screen.getByRole("button", { name: "Compare Courses" }));
    expect(screen.getByRole("button", { name: "Compare Courses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Same effort, different course" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Race Pacer" }));
    expect(within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent)).toEqual(before);
  });
});
