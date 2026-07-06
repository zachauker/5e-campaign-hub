"use client";

import React, { useEffect, useState } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { StatBlock } from "./StatBlock";
import { PCSheet } from "./PCSheet";
import { Button } from "@/components/ui/button";
import { X, RefreshCw, AlertTriangle } from "lucide-react";
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
  const { encounter, statBlockCombatantId, showStatBlock } = useEncounterStore();

  const combatant = encounter?.combatants.find((c) => c.id === statBlockCombatantId);
  const isPCWithSheet = combatant?.type === "pc" && !!combatant.ddbCharacter;
  const isOpen = isPCWithSheet || !!combatant?.statBlock;
  const hasError = combatant ? (syncErrors?.has(combatant.id) ?? false) : false;

  const syncLabel = useRelativeTime(lastSyncedAt ?? null);

  // Esc closes the panel — the close button's tooltip promises this shortcut.
  // Guard against firing while the DM is typing in a field (notes, HP, name).
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      showStatBlock(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, showStatBlock]);

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-card transition-[width] duration-300 ease-out overflow-hidden motion-reduce:transition-none",
        isOpen ? "w-80 min-w-80" : "w-0 min-w-0"
      )}
    >
      {isOpen && combatant && (
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

            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => showStatBlock(null)}
              className="shrink-0"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
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
      )}
    </div>
  );
}
