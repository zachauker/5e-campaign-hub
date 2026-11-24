"use client";

import React, { useEffect, useState } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { StatBlock } from "./StatBlock";
import { PCSheet } from "./PCSheet";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatBlockPanelProps {
  onRefresh?: () => void;
  lastSyncedAt?: Date | null;
  syncing?: boolean;
  syncErrors?: Set<string>;
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

/**
 * Live-updating relative time. The label is derived from `date` during render
 * (always fresh), and a 10s tick forces a re-render — no state mirroring in an
 * effect, so no cascading render.
 */
function useRelativeTime(date: Date | null): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [date]);

  return formatRelativeTime(date);
}

export function StatBlockPanel({ onRefresh, lastSyncedAt, syncing, syncErrors }: StatBlockPanelProps) {
  const { encounter, selectedCombatantId, selectCombatant } = useEncounterStore();

  const combatant = encounter?.combatants.find((c) => c.id === selectedCombatantId);
  const isPCWithSheet = combatant?.type === "pc" && !!combatant.ddbCharacter;
  const hasError = combatant ? (syncErrors?.has(combatant.id) ?? false) : false;

  const syncLabel = useRelativeTime(lastSyncedAt ?? null);

  // Esc clears the selection. Guard against firing while the DM is typing in a
  // field (notes, HP, name).
  useEffect(() => {
    if (!selectedCombatantId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      selectCombatant(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCombatantId, selectCombatant]);

  // Always rendered at a fixed width; only the content changes.
  return (
    <div className="flex flex-col border-l border-border bg-card overflow-hidden w-80 min-w-80">
      {combatant && (isPCWithSheet || combatant.statBlock) ? (
        <>
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-none gap-2">
            <span className="text-sm font-semibold shrink-0">
              {isPCWithSheet ? "Character Sheet" : "Stat Block"}
            </span>

            {isPCWithSheet && (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {/* Stale data warning */}
                {hasError && (
                  <span
                    className="flex items-center gap-0.5 text-[10px] text-warning shrink-0"
                    title="Sync failed — data may be stale"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Stale
                  </span>
                )}
                {/* Sync time */}
                {syncLabel && !hasError && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {syncing ? "Syncing…" : syncLabel}
                  </span>
                )}
                {syncing && !hasError && (
                  <span className="text-[10px] text-muted-foreground">Syncing…</span>
                )}
                {onRefresh && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={onRefresh}
                    disabled={syncing}
                    title="Refresh from D&D Beyond"
                    className="shrink-0 ml-auto"
                  >
                    <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {isPCWithSheet && combatant.ddbCharacter ? (
              <PCSheet char={combatant.ddbCharacter} />
            ) : combatant.statBlock ? (
              <StatBlock statBlock={combatant.statBlock} />
            ) : null}
          </div>
        </>
      ) : combatant ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-sm font-semibold">{combatant.name}</span>
          {/* Wired up in Task 10 */}
          <Button size="sm" variant="outline" disabled title="Coming soon">
            Link a stat sheet
          </Button>
          <Button size="sm" variant="outline" disabled title="Coming soon">
            Create a sheet
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          Select a combatant
        </div>
      )}
    </div>
  );
}
