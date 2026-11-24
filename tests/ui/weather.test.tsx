// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import type { WeatherReport } from "../../src/weather/types";
import "./setup";

type User = ReturnType<typeof userEvent.setup>;

const REPORT: WeatherReport = {
  place: "Lubbock, Texas",
  tempF: 71,
  tempC: 21.7,
  feelsLikeF: 70.2,
  feelsLikeC: 21.2,
  condition: "Partly cloudy",
  windMph: 8.1,
  windKph: 13,
  windDir: "NW",
  humidity: 45,
  observedAt: "2026-11-23 15:15",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
let getPosition: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn(async () => json(REPORT));
  vi.stubGlobal("fetch", fetchMock);
  // By default the browser refuses the automatic location request, so the typed-place form is what the tests use.
  getPosition = vi.fn();
  refuseLocation();
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: getPosition }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
});

/** What the browser does when the coach refuses, or can't give, a position. */
function refuseLocation(code = 1) {
  getPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code } as GeolocationPositionError));
}
function allowLocation() {
  getPosition.mockImplementation((ok: PositionCallback) =>
    ok({ coords: { latitude: 33.5779, longitude: -101.8552 } } as GeolocationPosition),
  );
}

async function typeInto(user: User, box: HTMLElement, text: string) {
  await user.clear(box);
  if (text) await user.type(box, text);
}

async function calculate5K(user: User) {
  await typeInto(user, screen.getByLabelText("Distance"), "5");
  await typeInto(user, screen.getByLabelText("Expected completion time"), "20:00");
  await user.click(screen.getByRole("button", { name: "Calculate" }));
}

/** Calculate a 5K and open Pacer Mode, where the weather card lives. */
async function openPacer(): Promise<User> {
  render(<App />);
  const user = userEvent.setup();
  await calculate5K(user);
  await user.click(screen.getByRole("button", { name: "Pacer Mode" }));
  return user;
}

const card = () => screen.getByRole("region", { name: "Weather" });
const ask = async (user: User, place: string) => {
  await typeInto(user, within(card()).getByLabelText("City or ZIP code"), place);
  await user.click(within(card()).getByRole("button", { name: "Get weather" }));
};

/** The value shown under a label inside the weather card, e.g. valueOf("Wind"). */
function valueOf(label: string): string | null {
  const term = within(card()).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

describe("weather is optional", () => {
  it("the calculator screen never asks for the location, and makes no request", async () => {
    render(<App />);
    const user = userEvent.setup();
    await calculate5K(user);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(getPosition).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the calculator needs no weather and no location: it works with fetch blocked entirely", async () => {
    fetchMock.mockRejectedValue(new TypeError("blocked"));
    render(<App />);
    const user = userEvent.setup();
    await calculate5K(user);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows the card on the Locations view only, not during Live Pacer", async () => {
    const user = await openPacer();
    expect(card()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Live Pacer" }));
    expect(screen.queryByRole("region", { name: "Weather" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Locations" }));
    expect(card()).toBeInTheDocument();
  });

  it("is not on the calculator screen", async () => {
    render(<App />);
    expect(screen.queryByRole("region", { name: "Weather" })).not.toBeInTheDocument();
  });
});

describe("looking up a place", () => {
  it("shows temperature, feels-like, conditions, wind and humidity", async () => {
    const user = await openPacer();
    await ask(user, "Lubbock, TX");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/weather?q=lubbock%2C%20tx");
    expect(await within(card()).findByText(/Lubbock, Texas/)).toBeInTheDocument();
    expect(within(card()).getByText(/updated 3:15 PM/)).toBeInTheDocument();
    expect(valueOf("Temperature")).toBe("71°F (22°C)");
    expect(valueOf("Feels like")).toBe("70°F (21°C)");
    expect(valueOf("Conditions")).toBe("Partly cloudy");
    expect(valueOf("Wind")).toBe("8 mph NW (13 km/h)");
    expect(valueOf("Humidity")).toBe("45%");
  });

  it("always shows the WeatherAPI.com credit and the disclaimer", async () => {
    const user = await openPacer();
    const link = within(card()).getByRole("link", { name: "WeatherAPI.com" });
    expect(link).toHaveAttribute("href", "https://www.weatherapi.com/");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(card()).toHaveTextContent(/not measured at the course/);
    await ask(user, "Lubbock");
    await within(card()).findByText("Temperature");
    expect(within(card()).getByRole("link", { name: "WeatherAPI.com" })).toBeInTheDocument();
  });

  it("tucks the form away after success and brings it back with Change place", async () => {
    const user = await openPacer();
    await ask(user, "Lubbock");
    await within(card()).findByText("Temperature");
    expect(within(card()).queryByLabelText("City or ZIP code")).not.toBeInTheDocument();
    await user.click(within(card()).getByRole("button", { name: "Change place" }));
    expect(within(card()).getByLabelText("City or ZIP code")).toBeInTheDocument();
  });

  it("does not ask the server for something obviously invalid", async () => {
    const user = await openPacer();
    await ask(user, "a");
    expect(within(card()).getByRole("status")).toHaveTextContent(/Enter a city or a ZIP code/);
    await ask(user, "x&y=1");
    expect(within(card()).getByRole("status")).toHaveTextContent(/Enter a city or a ZIP code/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a loading message while waiting, and disables the buttons so it can't be sent twice", async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    const user = await openPacer();
    await ask(user, "Lubbock");
    expect(within(card()).getByRole("status")).toHaveTextContent("Getting the weather…");
    expect(within(card()).getByRole("button", { name: "Get weather" })).toBeDisabled();
    expect(within(card()).getByRole("button", { name: "Use my location" })).toBeDisabled();
    finish(json(REPORT));
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
  });
});

describe("when weather can't be had, nothing else breaks", () => {
  const messages: Array<[string, () => Response | Promise<Response>, RegExp]> = [
    ["an unknown place", () => json({ error: "not_found" }, 404), /couldn't find that place/],
    ["a provider failure", () => json({ error: "unavailable" }, 502), /Weather isn't available right now/],
    ["a missing endpoint (HTML 404)", () => new Response("<html>404</html>", { status: 404 }), /Weather isn't available right now/],
    ["an HTML page instead of data", () => new Response("<html>hi</html>", { status: 200 }), /Weather isn't available right now/],
    ["a half-empty report", () => json({ place: "x" }), /Weather isn't available right now/],
  ];

  it.each(messages)("%s: shows a plain message and keeps the race and locations usable", async (_label, make, expected) => {
    fetchMock.mockImplementationOnce(async () => make());
    const user = await openPacer();
    await ask(user, "Lubbock");
    expect(await within(card()).findByText(expected)).toBeInTheDocument();
    // The rest of Pacer Mode is untouched.
    expect(screen.getByRole("heading", { name: "Active race" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import splits as locations" })).toBeEnabled();
    // And the coach can simply try again.
    expect(within(card()).getByRole("button", { name: "Get weather" })).toBeEnabled();
  });

  it("an offline network is handled the same way, and a retry works", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = await openPacer();
    await ask(user, "Lubbock");
    expect(await within(card()).findByText(/Weather isn't available right now/)).toBeInTheDocument();
    await user.click(within(card()).getByRole("button", { name: "Get weather" }));
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
    expect(within(card()).queryByText(/isn't available/)).not.toBeInTheDocument();
  });

  it("the locations features still work after a weather failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = await openPacer();
    await ask(user, "Lubbock");
    await within(card()).findByText(/isn't available/);
    await user.click(screen.getByRole("button", { name: "Import splits as locations" }));
    expect(screen.getByText(/Imported 3 locations/)).toBeInTheDocument();
  });
});

describe("automatic location: tried first, typed place as the fallback", () => {
  it("looks up the current location by itself when Pacer Mode opens, with nothing typed", async () => {
    allowLocation();
    await openPacer();
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/weather?q=33.58%2C-101.86");
    expect(valueOf("Temperature")).toBe("71°F (22°C)");
    // It worked, so the typed-place form is tucked away.
    expect(within(card()).queryByLabelText("City or ZIP code")).not.toBeInTheDocument();
  });

  it("asks the browser for a quick, low-accuracy position", async () => {
    allowLocation();
    await openPacer();
    expect(getPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: false, timeout: 10_000 });
  });

  it.each([
    ["refused", () => refuseLocation(1), /Location sharing wasn't allowed/],
    ["not found", () => refuseLocation(2), /Couldn't get your location/],
    ["timed out", () => refuseLocation(3), /Couldn't get your location/],
  ])("when the location is %s: says so and offers the typed form, with no weather request", async (_label, arrange, message) => {
    arrange();
    await openPacer();
    expect(await within(card()).findByText(message)).toBeInTheDocument();
    expect(within(card()).getByLabelText("City or ZIP code")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("when the browser has no geolocation at all: same fallback", async () => {
    Reflect.deleteProperty(navigator, "geolocation");
    await openPacer();
    expect(await within(card()).findByText(/can't share your location/)).toBeInTheDocument();
    expect(within(card()).getByLabelText("City or ZIP code")).toBeInTheDocument();
  });

  it("after a refusal the coach can type a city and get weather", async () => {
    const user = await openPacer();
    await within(card()).findByText(/Location sharing wasn't allowed/);
    await ask(user, "Lubbock, TX");
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/weather?q=lubbock%2C%20tx");
    // The refusal message is gone once there is weather.
    expect(within(card()).queryByText(/Location sharing wasn't allowed/)).not.toBeInTheDocument();
  });

  it("the Use my location button tries again (for example after the coach changes their mind)", async () => {
    const user = await openPacer();
    await within(card()).findByText(/Location sharing wasn't allowed/);
    allowLocation();
    await user.click(within(card()).getByRole("button", { name: "Use my location" }));
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
    expect(getPosition).toHaveBeenCalledTimes(2);
  });

  it("asks only once per visit: leaving and returning to Pacer Mode never prompts again", async () => {
    const user = await openPacer();
    await within(card()).findByText(/Location sharing wasn't allowed/);
    await user.click(screen.getByRole("button", { name: "Calculator" }));
    await user.click(screen.getByRole("button", { name: "Pacer Mode" }));
    await user.click(screen.getByRole("button", { name: "Live Pacer" }));
    await user.click(screen.getByRole("button", { name: "Locations" }));
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(/Location sharing wasn't allowed/)).toBeInTheDocument();
  });

  it("a coach who types a place while the location is still being found gets that place, and the late position is ignored", async () => {
    let giveLocation: PositionCallback = () => {};
    getPosition.mockImplementation((ok: PositionCallback) => {
      giveLocation = ok;
    });
    fetchMock.mockImplementation(async (url: string) =>
      json(String(url).includes("austin") ? { ...REPORT, place: "Austin, Texas" } : { ...REPORT, place: "Lubbock, Texas" }),
    );
    const user = await openPacer();
    expect(within(card()).getByRole("status")).toHaveTextContent("Finding the weather near you…");
    // Still locating: the typed form is usable and the Get weather button isn't locked.
    expect(within(card()).getByRole("button", { name: "Get weather" })).toBeEnabled();
    await ask(user, "Austin");
    expect(await within(card()).findByText(/Austin, Texas/)).toBeInTheDocument();

    giveLocation({ coords: { latitude: 33.5779, longitude: -101.8552 } } as GeolocationPosition); // arrives late
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(card()).getByText(/Austin, Texas/)).toBeInTheDocument();
    expect(within(card()).queryByText(/Lubbock/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("caching, refreshing and staying current", () => {
  it("asking again for the same place within 10 minutes doesn't call the server again", async () => {
    const user = await openPacer();
    await ask(user, "Lubbock");
    await within(card()).findByText("Temperature");
    await user.click(within(card()).getByRole("button", { name: "Change place" }));
    await ask(user, "  LUBBOCK ");
    expect(await within(card()).findByText("Temperature")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Refresh asks again and shows the new reading", async () => {
    const user = await openPacer();
    await ask(user, "Lubbock");
    await within(card()).findByText("Temperature");
    fetchMock.mockResolvedValueOnce(json({ ...REPORT, tempF: 75, tempC: 23.9, observedAt: "2026-11-23 15:30" }));
    await user.click(within(card()).getByRole("button", { name: "Refresh" }));
    expect(await within(card()).findByText(/updated 3:30 PM/)).toBeInTheDocument();
    expect(valueOf("Temperature")).toBe("75°F (24°C)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the weather when switching screens and back", async () => {
    const user = await openPacer();
    await ask(user, "Lubbock");
    await within(card()).findByText("Temperature");
    await user.click(screen.getByRole("button", { name: "Calculator" }));
    await user.click(screen.getByRole("button", { name: "Pacer Mode" }));
    expect(valueOf("Temperature")).toBe("71°F (22°C)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
