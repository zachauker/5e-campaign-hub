import { describe, it, expect } from "vitest";
import { eventDatesOf, defaultEventDate, filterByEventDate } from "./event-date-filter";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: Math.random().toString(), mapId: "map", x: 0, y: 0, type: "event", entityId: "n", targetMapId: null,
  title: null, note: null, minZoom: null, resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("eventDatesOf", () => {
  it("returns distinct sorted event dates, ignoring non-events and undated", () => {
    const dates = eventDatesOf([
      marker({ eventDate: "2026-07-19" }),
      marker({ eventDate: "2026-07-05" }),
      marker({ eventDate: "2026-07-19" }),
      marker({ eventDate: null }),
      marker({ type: "note", eventDate: undefined }),
    ]);
    expect(dates).toEqual(["2026-07-05", "2026-07-19"]);
  });
});

describe("defaultEventDate", () => {
  it("picks the earliest date on or after today", () => {
    expect(defaultEventDate(["2026-07-05", "2026-07-19", "2026-08-01"], "2026-07-14")).toBe("2026-07-19");
  });
  it("falls back to the latest past date when all are in the past", () => {
    expect(defaultEventDate(["2026-06-01", "2026-07-05"], "2026-07-14")).toBe("2026-07-05");
  });
  it("returns null when there are no dates", () => {
    expect(defaultEventDate([], "2026-07-14")).toBeNull();
  });
});

describe("filterByEventDate", () => {
  const markers = [
    marker({ eventDate: "2026-07-19" }),
    marker({ eventDate: "2026-07-05" }),
    marker({ eventDate: null }),
    marker({ type: "location", eventDate: undefined }),
  ];
  it("keeps non-events, undated events, and events on the selected date", () => {
    const kept = filterByEventDate(markers, "2026-07-19");
    expect(kept).toHaveLength(3); // the 07-19 event, the undated event, the location
  });
  it("keeps everything when the date is null (All dates)", () => {
    expect(filterByEventDate(markers, null)).toHaveLength(4);
  });
});
