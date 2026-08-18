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
import { formatInWorldDay } from "@/lib/calendar/exandria";

interface DueTick {
  clockId: string;
  name: string;
  ticks: number;
  rawTicks: number;
  elapsedDays: number;
  fromFilled: number;
  toFilled: number;
  completes: boolean;
}

type PreviewResult = { ok: true; dueTicks: DueTick[] } | { ok: false; error: string };
type ApplyResult = { ok: true } | { ok: false; error: string };

async function fetchPreview(campaignId: string, toDay: number): Promise<PreviewResult> {
  const res = await fetch(`/api/campaigns/${campaignId}/advance-date`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toDay }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Preview failed" };
  }
  const data = (await res.json()) as { dueTicks: DueTick[] };
  return { ok: true, dueTicks: data.dueTicks };
}

async function postApply(campaignId: string, toDay: number, clockIds: string[]): Promise<ApplyResult> {
  const res = await fetch(`/api/campaigns/${campaignId}/advance-date`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toDay, apply: { clockIds } }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Could not advance the date" };
  }
  return { ok: true };
}

interface AdvanceDateDialogProps {
  campaignId: string;
  currentDay: number;
  epochLabel: string;
  /** Prefilled target day, e.g. from a review proposal. */
  seedToDay?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}

/**
 * Preview-then-apply confirmation for advancing in-world time. Posting
 * `{toDay}` alone (preview) mutates nothing; only `{toDay, apply:{clockIds}}`
 * writes. This dialog always previews first and lets the DM uncheck rows
 * before anything is applied.
 *
 * The dialog is kept mounted by the caller and toggled via `open` (see
 * TimelineTab), so state is reset explicitly whenever it opens rather than
 * relying on a fresh mount.
 */
export function AdvanceDateDialog({
  campaignId,
  currentDay,
  epochLabel,
  seedToDay,
  open,
  onOpenChange,
  onApplied,
}: AdvanceDateDialogProps) {
  const [days, setDays] = useState(String(seedToDay != null ? Math.max(1, seedToDay - currentDay) : 1));
  const [due, setDue] = useState<DueTick[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numDays = Number(days);
  const validDays = Number.isFinite(numDays) && numDays > 0;
  const toDay = currentDay + (validDays ? numDays : 0);

  function applyPreview(result: PreviewResult) {
    if (result.ok) {
      setError(null);
      setDue(result.dueTicks);
      // Everything due is accepted by default; the DM unchecks what they don't want.
      setAccepted(new Set(result.dueTicks.map((t) => t.clockId)));
    } else {
      setError(result.error);
      setDue(null);
    }
  }

  async function runPreview() {
    if (!validDays) return;
    setError(null);
    setBusy(true);
    const result = await fetchPreview(campaignId, toDay);
    setBusy(false);
    applyPreview(result);
  }

  // Reset and auto-preview whenever the dialog opens (fresh state each time,
  // since the caller keeps this component mounted and only toggles `open`;
  // this is also the path Task 15's pre-seeded review proposal exercises).
  // Cancellation-guarded async inside the effect, matching
  // ChronicleBrowser.tsx's fetch pattern — this repo's
  // react-hooks/set-state-in-effect rule rejects a bare
  // `useEffect(() => { void load(); }, [load])`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function run() {
      const initialDays = String(seedToDay != null ? Math.max(1, seedToDay - currentDay) : 1);
      setDays(initialDays);
      setDue(null);
      setAccepted(new Set());
      setError(null);
      const initialNum = Number(initialDays);
      if (!(initialNum > 0)) return;
      const result = await fetchPreview(campaignId, currentDay + initialNum);
      if (!cancelled) applyPreview(result);
    }
    void run();
    return () => {
      cancelled = true;
    };
    // Intentionally only `open`: this should re-run when the dialog opens,
    // not on every keystroke in the days field — the Preview button covers
    // that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function apply() {
    if (!validDays) return;
    setBusy(true);
    const result = await postApply(campaignId, toDay, [...accepted]);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onApplied();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Advance in-world time</DialogTitle>
          <DialogDescription>
            Preview what would tick before anything changes, then confirm once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Days to advance</span>
              <Input className="w-24" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <Button variant="ghost" onClick={() => void runPreview()} disabled={busy || !validDays}>
              Preview
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {formatInWorldDay(currentDay, epochLabel)} →{" "}
            <strong>{validDays ? formatInWorldDay(toDay, epochLabel) : "—"}</strong>
          </p>

          {due && due.length === 0 && (
            <p className="text-sm text-muted-foreground">No clocks are due at that date.</p>
          )}

          {due && due.length > 0 && (
            <ul className="space-y-2">
              {due.map((t) => (
                <li key={t.clockId} className="flex items-start gap-2 rounded-md border border-border p-2">
                  <input
                    id={`tick-${t.clockId}`}
                    type="checkbox"
                    className="mt-1"
                    checked={accepted.has(t.clockId)}
                    onChange={(e) => {
                      const next = new Set(accepted);
                      if (e.target.checked) next.add(t.clockId);
                      else next.delete(t.clockId);
                      setAccepted(next);
                    }}
                  />
                  <label htmlFor={`tick-${t.clockId}`} className="text-sm">
                    <span className="font-medium">{t.name}</span> +{t.ticks}{" "}
                    <span className="text-muted-foreground">
                      ({t.fromFilled} → {t.toFilled}, {t.elapsedDays} days elapsed)
                    </span>
                    {t.completes && <span className="ml-1 text-destructive">fills</span>}
                    {t.rawTicks > t.ticks && (
                      <span className="ml-1 text-muted-foreground">· capped from +{t.rawTicks}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Unchecked clocks are skipped, not deferred — they will not be re-proposed on the next advance.
          </p>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void apply()} disabled={busy || !validDays}>
              {busy ? "Working…" : "Advance"}
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
