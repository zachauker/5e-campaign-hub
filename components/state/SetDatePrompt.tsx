"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXANDRIA } from "@/lib/calendar/exandria";

interface SetDatePromptProps {
  campaignId: string;
  /** Prefills when correcting an existing date. */
  initialDay?: number | null;
  initialEpochLabel?: string;
  onSaved: () => void;
  onCancel?: () => void;
}

export function SetDatePrompt({
  campaignId,
  initialDay,
  initialEpochLabel,
  onSaved,
  onCancel,
}: SetDatePromptProps) {
  const initial = initialDay != null ? EXANDRIA.toParts(initialDay) : { year: 843, monthIndex: 0, dayOfMonth: 1 };
  const [year, setYear] = useState(String(initial.year));
  const [monthIndex, setMonthIndex] = useState(initial.monthIndex);
  const [dayOfMonth, setDayOfMonth] = useState(String(initial.dayOfMonth));
  const [epochLabel, setEpochLabel] = useState(initialEpochLabel ?? "P.D.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let day: number;
    try {
      day = EXANDRIA.fromParts({
        year: Number(year),
        monthIndex,
        dayOfMonth: Number(dayOfMonth),
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/set-date`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day, epochLabel }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not set the date");
      return;
    }
    onSaved();
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-semibold">Set the in-world date</h2>
        <p className="text-sm text-muted-foreground">
          Threads, clocks, and the timeline are all positioned by this date. Setting it here does not tick any
          clocks.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          aria-label="Day of month"
          className="w-20"
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
        />
        <select
          aria-label="Month"
          className="flex-1 rounded-md border border-border bg-background px-2 text-sm"
          value={monthIndex}
          onChange={(e) => setMonthIndex(Number(e.target.value))}
        >
          {EXANDRIA.months.map((m, i) => (
            <option key={m.name} value={i}>
              {m.name} ({m.days} days)
            </option>
          ))}
        </select>
        <Input aria-label="Year" className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />
        <Input
          aria-label="Epoch label"
          className="w-20"
          value={epochLabel}
          onChange={(e) => setEpochLabel(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Set date"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
