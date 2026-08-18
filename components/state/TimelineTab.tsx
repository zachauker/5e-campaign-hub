"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClockDial } from "./ClockDial";
import { AdvanceDateDialog } from "./AdvanceDateDialog";
import type { CampaignStateView } from "./chronicle-types";

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

export function TimelineTab({ campaignId, state, onChanged }: TimelineTabProps) {
  const [advancing, setAdvancing] = useState(false);
  const running = state.clocks.filter((c) => c.status !== "complete");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          {running.length === 0 && <p className="text-sm text-muted-foreground">No running clocks.</p>}
          {running.map((c) => (
            <ClockDial key={c.id} name={c.name} segments={c.segments} filled={c.filled} status={c.status} />
          ))}
        </div>
        <Button onClick={() => setAdvancing(true)} disabled={state.currentDay === null}>
          Advance time
        </Button>
      </div>

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
    </div>
  );
}
