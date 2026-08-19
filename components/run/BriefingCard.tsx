"use client";

import React, { useState } from "react";
import { AlertTriangle, Eye, EyeOff, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BriefingCardData {
  targetKind: string;
  targetId: string;
  name: string;
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  partial: boolean;
}

interface BriefingCardProps {
  name: string;
  briefing: BriefingCardData | null;
  /** Shown when there is no briefing: description, notionProps summary, thread titles. */
  fallback: { description: string | null; threads: string[] };
  stale: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onBuild: () => void;
  building: boolean;
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm leading-snug text-foreground">{value}</div>
    </div>
  );
}

export function BriefingCard({
  name, briefing, fallback, stale, pinned, onTogglePin, onBuild, building,
}: BriefingCardProps) {
  const [secretShown, setSecretShown] = useState(false);

  return (
    <div className={cn(
      "rounded-lg border border-border bg-card p-4 space-y-3",
      pinned && "border-amber-500/50",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold leading-tight text-foreground">{name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {stale && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Behind its notes
              </Badge>
            )}
            {briefing?.partial && (
              <Badge variant="outline" className="text-[10px]">Built without the page body</Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
        >
          {pinned ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
        </Button>
      </div>

      {briefing ? (
        <div className="space-y-2.5">
          <Field label="Is" value={briefing.identity} />
          <Field label="Wants" value={briefing.wants} />
          <Field label="Party knows" value={briefing.partyKnows} />
          <Field label="Voice" value={briefing.voice} />
          {briefing.secret && (
            <div className="space-y-0.5">
              {/* aria-expanded because the Eye/EyeOff swap is aria-hidden — without
                  it a screen reader gets no signal that the secret is revealed. */}
              <button
                type="button"
                onClick={() => setSecretShown((s) => !s)}
                aria-expanded={secretShown}
                className="flex items-center gap-1.5 rounded-sm text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {secretShown
                  ? <EyeOff className="h-3 w-3" aria-hidden />
                  : <Eye className="h-3 w-3" aria-hidden />}
                Secret
              </button>
              {secretShown && (
                <div className="text-sm leading-snug text-amber-200">{briefing.secret}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        // Degraded, never empty. A card that says "no briefing yet" and nothing
        // else is worse than the raw description the DM already had.
        <div className="space-y-2.5">
          <Field label="Notes" value={fallback.description ?? "Nothing recorded locally."} />
          {fallback.threads.length > 0 && (
            <Field label="Open threads" value={fallback.threads.join(" · ")} />
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onBuild} disabled={building}>
            {building ? "Building briefing…" : "Build briefing"}
          </Button>
        </div>
      )}
    </div>
  );
}
