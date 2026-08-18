"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CLOCK_SEGMENT_CHOICES, CLOCK_STATUSES, type ClockOwnerKind } from "@/lib/state/clock-constants";
import {
  ENTITY_KIND_LABELS,
  fetchEntityOptions,
  type EntityOptions,
  type StateEntityKind,
} from "./entity-options";
import type { ClockView } from "./chronicle-types";

/**
 * `ClockOwnerKind` also allows "thread", but there is no thread detail page for
 * an owned clock to surface on, so offering it would produce a clock nobody can
 * find. Factions and locations both have detail pages that render owned clocks.
 */
const OWNER_KINDS: StateEntityKind[] = ["faction", "location"];

interface ClockFormDialogProps {
  campaignId: string;
  /** Omit to create a new clock. */
  clock?: ClockView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Create/edit form for a clock. Seeds its fields from props via `useState`, so
 * callers must mount it FRESH per edit (render it conditionally) rather than
 * keeping it mounted and toggling `open` — same contract as ThreadFormDialog.
 */
export function ClockFormDialog({ campaignId, clock, open, onOpenChange, onSaved }: ClockFormDialogProps) {
  const [name, setName] = useState(clock?.name ?? "");
  const [segments, setSegments] = useState<number>(clock?.segments ?? 8);
  // Blank means manual-only: no cadence, so the clock never ticks on its own.
  const [cadenceDays, setCadenceDays] = useState(clock?.cadenceDays == null ? "" : String(clock.cadenceDays));
  const [payoff, setPayoff] = useState(clock?.payoff ?? "");
  const [ownerKind, setOwnerKind] = useState<string>(clock?.ownerKind ?? "");
  const [ownerId, setOwnerId] = useState<string>(clock?.ownerId ?? "");
  const [status, setStatus] = useState<string>(clock?.status ?? "running");
  const [options, setOptions] = useState<EntityOptions>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cancellation-guarded async inside the effect (not `void load()` on a
  // useCallback), matching ChronicleBrowser.tsx — this repo's
  // react-hooks/set-state-in-effect rule rejects the latter.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const result = await fetchEntityOptions(campaignId, OWNER_KINDS);
      if (cancelled) return;
      if (result.ok) {
        setOptions(result.options);
        setOptionsError(null);
      } else {
        setOptionsError(result.error);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const ownerList = ownerKind ? (options[ownerKind as StateEntityKind] ?? []) : [];

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }

    const trimmedCadence = cadenceDays.trim();
    let cadence: number | null = null;
    if (trimmedCadence) {
      cadence = Number(trimmedCadence);
      if (!Number.isInteger(cadence) || cadence <= 0) {
        setError("Cadence must be a whole number of days above zero, or blank for manual-only.");
        return;
      }
    }

    if (ownerKind && !ownerId) {
      setError(`Pick which ${ownerKind} owns this clock, or set the owner back to none.`);
      return;
    }

    const payload = {
      campaignId,
      name,
      segments,
      cadenceDays: cadence,
      payoff: payoff.trim() ? payoff : null,
      ownerKind: (ownerKind || null) as ClockOwnerKind | null,
      ownerId: ownerKind ? ownerId : null,
      ...(clock ? { status } : {}),
    };

    setBusy(true);
    const res = clock
      ? await fetch(`/api/clocks/${clock.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/clocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
    setBusy(false);

    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save the clock");
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{clock ? "Edit clock" : "New clock"}</DialogTitle>
          <DialogDescription>
            A clock is something closing in on the party. It fills a segment at a time — on its own as
            in-world days pass, or whenever you say so.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Name (e.g. &ldquo;The Assembly closes in&rdquo;)
            </span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block text-muted-foreground">Segments</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={segments}
                onChange={(e) => setSegments(Number(e.target.value))}
              >
                {CLOCK_SEGMENT_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="block flex-1 text-sm">
              <span className="mb-1 block text-muted-foreground">Ticks every … days</span>
              <Input
                inputMode="numeric"
                placeholder="blank = manual only"
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Payoff — what happens when it fills</span>
            <Input value={payoff} onChange={(e) => setPayoff(e.target.value)} />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block text-muted-foreground">Owner</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={ownerKind}
                onChange={(e) => {
                  setOwnerKind(e.target.value);
                  setOwnerId("");
                }}
              >
                <option value="">No owner</option>
                {OWNER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ENTITY_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>

            {ownerKind && (
              <label className="block flex-1 text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Which {ENTITY_KIND_LABELS[ownerKind as StateEntityKind].toLowerCase()}
                </span>
                <select
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {ownerList.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {optionsError && (
            <p role="alert" className="text-sm text-destructive">
              {optionsError} The owner list may be incomplete.
            </p>
          )}

          {clock && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Status</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {CLOCK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
