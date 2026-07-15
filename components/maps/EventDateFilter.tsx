"use client";

import React from "react";
import { CalendarDays } from "lucide-react";

interface EventDateFilterProps {
  dates: string[];              // ascending, from eventDatesOf
  selected: string | null;      // null = All dates
  onChange: (date: string | null) => void;
}

// Compact selector shown only when a map has dated event pins. "All dates"
// clears the filter; each option is a session date.
export function EventDateFilter({ dates, selected, onChange }: EventDateFilterProps) {
  if (dates.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs">
      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
      <select
        aria-label="Filter events by session date"
        value={selected ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="bg-transparent focus:outline-none"
      >
        <option value="">All dates</option>
        {dates.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </label>
  );
}
