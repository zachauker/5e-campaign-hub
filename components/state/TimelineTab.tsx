"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ClockDial } from "./ClockDial";
import { AdvanceDateDialog } from "./AdvanceDateDialog";
import { ClockFormDialog } from "./ClockFormDialog";
import type { CampaignStateView, ClockView } from "./chronicle-types";

const SOURCE_LABEL: Record<string, string> = {
  manual: "manual",
  proposal: "from review",
  cadence: "time",
};

interface TimelineTabProps {
  campaignId: string;
  state: CampaignStateView;
  onChanged: () => void;
}

function cadenceLabel(clock: ClockView): string {
  if (clock.cadenceDays === null) return "manual only";
  return clock.cadenceDays === 1 ? "ticks daily" : `ticks every ${clock.cadenceDays} days`;
}

export function TimelineTab({ campaignId, state, onChanged }: TimelineTabProps) {
  const confirm = useConfirm();
  const [advancing, setAdvancing] = useState(false);
  const [creatingClock, setCreatingClock] = useState(false);
  const [editingClock, setEditingClock] = useState<ClockView | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);
  // The id of the clock with a write in flight, so its own buttons disable
  // without freezing every other clock's.
  const [pendingClockId, setPendingClockId] = useState<string | null>(null);

  async function failureMessage(res: Response, fallback: string): Promise<string> {
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;
  }

  async function tick(clock: ClockView, delta: number) {
    setClockError(null);
    setPendingClockId(clock.id);
    const res = await fetch(`/api/clocks/${clock.id}/tick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delta }),
    });
    setPendingClockId(null);
    if (!res.ok) {
      setClockError(await failureMessage(res, `Could not tick "${clock.name}"`));
      return;
    }
    onChanged();
  }

  async function remove(clock: ClockView) {
    const ok = await confirm({
      title: `Delete "${clock.name}"?`,
      description:
        "The clock and its dial go away for good. Timeline events it already wrote stay in the chronicle.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    setClockError(null);
    setPendingClockId(clock.id);
    const res = await fetch(`/api/clocks/${clock.id}`, { method: "DELETE" });
    setPendingClockId(null);
    if (!res.ok) {
      setClockError(await failureMessage(res, `Could not delete "${clock.name}"`));
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clocks</h3>
          <div className="flex flex-none items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreatingClock(true)}>
              New clock
            </Button>
            <Button size="sm" onClick={() => setAdvancing(true)} disabled={state.currentDay === null}>
              Advance time
            </Button>
          </div>
        </div>

        {clockError && (
          <p role="alert" className="text-sm text-destructive">
            {clockError}
          </p>
        )}

        {state.clocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clocks yet. Start one for anything closing in on the party — a rival&rsquo;s plan, a rising
            tide, a countdown the table can feel.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {state.clocks.map((c) => {
              const pending = pendingClockId === c.id;
              return (
                <li key={c.id} className="flex w-56 flex-col gap-2 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <ClockDial name={c.name} segments={c.segments} filled={c.filled} status={c.status} />
                    {/* Status is spelled out, never left to the dial's colour alone. */}
                    {c.status !== "running" && (
                      <Badge variant="outline" className="flex-none text-[11px]">
                        {c.status}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">{cadenceLabel(c)}</p>
                  {c.payoff && <p className="text-xs text-muted-foreground">Payoff: {c.payoff}</p>}

                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Tick "${c.name}" down one segment`}
                      disabled={pending || c.filled <= 0}
                      onClick={() => void tick(c, -1)}
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Tick "${c.name}" up one segment`}
                      disabled={pending || c.filled >= c.segments}
                      onClick={() => void tick(c, 1)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditingClock(c)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => void remove(c)}>
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
        {state.events.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing has happened yet. Advancing time or reviewing a session will fill this in.
          </p>
        )}
        <ul className="space-y-2">
          {state.events.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{e.title}</p>
                <span className="flex-none text-xs text-muted-foreground">{e.dateLabel}</span>
              </div>
              {e.body && <p className="mt-0.5 text-sm text-muted-foreground">{e.body}</p>}
              <Badge variant="outline" className="mt-2 text-[11px]">
                {SOURCE_LABEL[e.sourceKind] ?? e.sourceKind}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      {state.currentDay !== null && (
        <AdvanceDateDialog
          campaignId={campaignId}
          currentDay={state.currentDay}
          epochLabel={state.epochLabel}
          open={advancing}
          onOpenChange={setAdvancing}
          onApplied={onChanged}
        />
      )}

      {/* Mounted fresh per edit: ClockFormDialog seeds its fields from props via
          useState, so keeping it mounted would show the previous clock's values
          on the second edit. Same contract as ThreadFormDialog. */}
      {(creatingClock || editingClock) && (
        <ClockFormDialog
          campaignId={campaignId}
          clock={editingClock}
          open
          onOpenChange={(o) => {
            if (!o) {
              setCreatingClock(false);
              setEditingClock(null);
            }
          }}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}
