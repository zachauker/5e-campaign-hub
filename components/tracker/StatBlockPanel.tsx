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

function useRelativeTime(date: Date | null): string {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!date) { setLabel(""); return; }

    function update() {
      if (!date) return;
      const secs = Math.floor((Date.now() - date.getTime()) / 1000);
      if (secs < 10) setLabel("just now");
      else if (secs < 60) setLabel(`${secs}s ago`);
      else setLabel(`${Math.floor(secs / 60)}m ago`);
    }

    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [date]);

  return label;
}

export function StatBlockPanel({ onRefresh, lastSyncedAt, syncing, syncErrors }: StatBlockPanelProps) {
  const { encounter, statBlockCombatantId, showStatBlock } = useEncounterStore();

  const combatant = encounter?.combatants.find((c) => c.id === statBlockCombatantId);
  const isPCWithSheet = combatant?.type === "pc" && !!combatant.ddbCharacter;
  const isOpen = isPCWithSheet || !!combatant?.statBlock;
  const hasError = combatant ? (syncErrors?.has(combatant.id) ?? false) : false;

  const syncLabel = useRelativeTime(lastSyncedAt ?? null);

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-card transition-all duration-300 overflow-hidden",
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
                    className="flex items-center gap-0.5 text-[10px] text-amber-400 shrink-0"
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
