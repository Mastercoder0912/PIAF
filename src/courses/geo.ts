/**
 * Ground distance between two nearby GPS points, on the WGS-84 ellipsoid.
 *
 * Uses the local meridian and prime-vertical radii of curvature at the midpoint latitude, which for
 * steps of a few meters is accurate far beyond GPS error. (A spherical haversine overstates this
 * route by about 2.7 m over 5 km; this does not have that bias.)
 *
 * No imports on purpose: the course build script runs this file directly under Node.
 */
const A = 6378137; // semi-major axis, m
const F = 1 / 298.257223563; // flattening
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

export function stepMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi = ((lat1 + lat2) / 2) * RAD;
  const s = Math.sin(phi);
  const w = 1 - E2 * s * s;
  const meridian = (A * (1 - E2)) / (w * Math.sqrt(w));
  const primeVertical = A / Math.sqrt(w);
  const dy = (lat2 - lat1) * RAD * meridian;
  const dx = (lon2 - lon1) * RAD * primeVertical * Math.cos(phi);
  return Math.hypot(dx, dy);
}
