import type { ResolvedMarker } from "@/components/maps/map-types";

/** Distinct event dates present among markers, ascending. Ignores non-events and undated events. */
export function eventDatesOf(markers: ResolvedMarker[]): string[] {
  const set = new Set<string>();
  for (const m of markers) {
    if (m.type === "event" && m.eventDate) set.add(m.eventDate);
  }
  return [...set].sort();
}

/**
 * Default selected date: the earliest date on or after `today` (the next
 * upcoming session). If every date is in the past, the latest past date. Null
 * if there are no dates. `dates` is assumed ascending (from eventDatesOf).
 */
export function defaultEventDate(dates: string[], today: string): string | null {
  if (dates.length === 0) return null;
  const upcoming = dates.find((d) => d >= today);
  return upcoming ?? dates[dates.length - 1];
}

/**
 * Keep a marker when: it isn't an event; OR the date filter is off (null); OR
 * the event has no date (can't be filtered by a field it lacks); OR the event's
 * date equals the selected date.
 */
export function filterByEventDate(markers: ResolvedMarker[], selected: string | null): ResolvedMarker[] {
  if (selected === null) return markers;
  return markers.filter((m) => m.type !== "event" || !m.eventDate || m.eventDate === selected);
}

/** Today as an ISO date string in the viewer's local timezone. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
