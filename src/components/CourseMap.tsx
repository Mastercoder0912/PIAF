import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { elevationRuns, routeParts } from "../courses/route";
import type { CourseData, CoursePosition } from "../courses/types";

/**
 * The course on a map: the route, start and end, and a marker for the current position.
 *
 * Map tiles come from OpenStreetMap's public tile server (https://tile.openstreetmap.org), free and keyless,
 * with the required attribution. The route itself is drawn by the browser and does not depend on tiles, so if
 * tiles can't load the route is still there on a plain background.
 *
 * The component only draws: where the marker goes is decided by the parent (see courses/position.ts).
 */

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

// Start is the app's cobalt and End/position are navy: none of them can be mistaken for the green-to-red elevation colors.
const START = "#2563eb";
const INK = "#0f172a";
const WARN = "#b45309";

export function CourseMap({ course, position }: { course: CourseData; position: CoursePosition }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Build the map once per course.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setTilesFailed(false);

    const map = L.map(host, {
      // A phone's finger should scroll the page, not drag the map; the marker pans the map back into view instead.
      dragging: !L.Browser.mobile,
      scrollWheelZoom: false,
      zoomSnap: 0.25,
    });

    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION });
    tiles.on("tileerror", () => setTilesFailed(true));
    tiles.on("tileload", () => setTilesFailed(false));
    tiles.addTo(map);

    const { solid, dashed } = routeParts(course);
    // A dark casing under a bright line keeps the route readable on any map background.
    for (const part of solid) L.polyline(part, { color: INK, weight: 8, opacity: 0.5, interactive: false }).addTo(map);
    // The route is colored by elevation: lowest point green, highest red, a gradient in between.
    for (const run of elevationRuns(course)) {
      L.polyline(run.points, { color: run.color, weight: 5, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false, className: "course-route" }).addTo(map);
    }
    for (const part of dashed) {
      L.polyline(part, { color: WARN, weight: 4, opacity: 1, dashArray: "2 8", lineCap: "round", interactive: false, className: "course-route-gap" }).addTo(map);
    }

    const first = course.points[0]!;
    const last = course.points[course.points.length - 1]!;
    const label = { permanent: true, direction: "top" as const, offset: [0, -6] as [number, number], className: "course-label" };
    L.circleMarker([first[0], first[1]], { radius: 6, color: "#ffffff", weight: 2, fillColor: START, fillOpacity: 1, interactive: false })
      .bindTooltip("Start", label)
      .addTo(map);
    L.circleMarker([last[0], last[1]], { radius: 6, color: "#ffffff", weight: 2, fillColor: INK, fillOpacity: 1, interactive: false })
      .bindTooltip("End", label)
      .addTo(map);

    const [south, west, north, east] = course.bounds;
    map.fitBounds([[south, west], [north, east]], { padding: [28, 28] });

    // The position marker goes last so it draws on top.
    const marker = L.circleMarker([first[0], first[1]], {
      radius: 11,
      color: "#ffffff",
      weight: 4,
      fillColor: INK,
      fillOpacity: 1,
      interactive: false,
      className: "course-position-marker",
    }).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    // Keep the map correct if its box changes size (rotating a phone, resizing a window).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
    observer?.observe(host);

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [course]);

  // Follow the position. Dragging the slider only moves this marker; it never rebuilds the map.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    const at = L.latLng(position.lat, position.lon);
    marker.setLatLng(at);
    marker.setStyle({ color: position.inGap ? WARN : "#ffffff" });
    // If the coach has zoomed in and the marker would leave the view, bring it back.
    map.panInside(at, { padding: [48, 48], animate: false });
  }, [position.lat, position.lon, position.inGap]);

  return (
    <div className="course-map-wrap">
      <div
        ref={hostRef}
        className="course-map"
        role="application"
        aria-label={`Map of the ${course.name} route. Use the position slider below to move the marker.`}
      />
      {tilesFailed ? (
        <p className="course-map-note" role="status">
          The map background couldn't load. The route is still shown.
        </p>
      ) : null}
    </div>
  );
}
