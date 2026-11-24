/** Optional "Use my location". Only ever called from a button press, never on page load. */

export type PositionResult =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; error: "location_denied" | "location_unsupported" | "location_failed" };

export function getCurrentPosition(
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (!geolocation) {
      resolve({ ok: false, error: "location_unsupported" });
      return;
    }
    geolocation.getCurrentPosition(
      (position) => resolve({ ok: true, latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (failure) =>
        resolve({
          ok: false,
          // 1 = PERMISSION_DENIED. Timeouts and "position unavailable" are not the coach's choice.
          error: failure.code === 1 ? "location_denied" : "location_failed",
        }),
      // Low accuracy is plenty for weather, and it answers faster. A recent position is fine.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
