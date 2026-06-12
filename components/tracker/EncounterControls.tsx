"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  SkipForward,
  SkipBack,
  Square,
  RotateCcw,
  Save,
  Plus,
  Swords,
  Edit2,
  Check,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AddCombatantDialog } from "./AddCombatantDialog";

interface EncounterControlsProps {
  onSave: () => Promise<void>;
  saving: boolean;
  saveError?: string | null;
  onNavigateBack: () => void;
}

export function EncounterControls({ onSave, saving, saveError, onNavigateBack }: EncounterControlsProps) {
  const {
    encounter,
    nextTurn,
    prevTurn,
    startEncounter,
    endEncounter,
    resetRound,
    isDirty,
    showStatBlock,
  } = useEncounterStore();

  const [addOpen, setAddOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(encounter?.name ?? "");

  useEffect(() => {
    setNameVal(encounter?.name ?? "");
  }, [encounter?.name]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if (e.key === "n" || e.key === "ArrowRight") { e.preventDefault(); nextTurn(); }
      if (e.key === "p" || e.key === "ArrowLeft") { e.preventDefault(); prevTurn(); }
      if (e.key === "a") { e.preventDefault(); setAddOpen(true); }
      if (e.key === "s" || e.key === "S") {
        const state = useEncounterStore.getState();
        const currentId = state.encounter?.currentCombatantId;
        if (currentId) { e.preventDefault(); showStatBlock(currentId); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); onSave(); }
    },
    [nextTurn, prevTurn, onSave, showStatBlock]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!encounter) return null;

  const isActive = encounter.status === "active";
  const currentCombatant = encounter.combatants.find(
    (c) => c.id === encounter.currentCombatantId
  );

  async function saveName() {
    if (nameVal.trim() && nameVal !== encounter?.name) {
      await fetch(`/api/encounters/${encounter!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameVal.trim() }),
      });
    }
    setEditingName(false);
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm">
      {/* Row 1: back + encounter name + save */}
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onNavigateBack}
          className="flex-none opacity-50 hover:opacity-100 transition-opacity"
          title="Back to encounters"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <Swords className="w-4 h-4 text-primary flex-none" />
        {editingName ? (
          <div className="flex items-center gap-1 flex-1">
            <Input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="h-7 text-sm font-semibold"
            />
            <Button size="icon-sm" variant="ghost" onClick={saveName}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{encounter.name}</h1>
            <Button
              size="icon-sm"
              variant="ghost"
              className="flex-none opacity-40 hover:opacity-100 transition-opacity"
              onClick={() => setEditingName(true)}
            >
              <Edit2 className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Save state */}
        {saveError ? (
          <div className="flex items-center gap-1 flex-none text-destructive">
            <AlertCircle className="w-3 h-3" />
            <span className="text-xs">Save failed</span>
            <Button size="sm" variant="ghost" onClick={onSave} className="h-6 text-xs px-1.5">
              Retry
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onSave}
            disabled={saving || !isDirty}
            className={cn(
              "gap-1 flex-none text-xs transition-colors",
              isDirty ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving…" : isDirty ? "Save" : "Saved"}
          </Button>
        )}
      </div>

      {/* Row 2: combat readout + controls */}
      <div className="flex items-center gap-2">
        {/* Round + active combatant — the war-room readout */}
        <div className="flex items-center gap-3 bg-muted rounded-lg px-3 py-1.5 flex-none">
          <div className="min-w-[1.75rem] text-center">
            <p className="text-[9px] text-muted-foreground leading-none mb-0.5">round</p>
            <p className="text-2xl font-bold text-[var(--initiative)] leading-none tabular-nums">
              {encounter.round}
            </p>
          </div>
          {isActive && currentCombatant && (
            <>
              <div className="w-px h-8 bg-border" />
              <div className="min-w-0 max-w-36">
                <p className="text-[9px] text-muted-foreground leading-none mb-0.5">active</p>
                <p className="text-sm font-bold truncate text-[var(--initiative)]">
                  {currentCombatant.name}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Combat controls */}
        <div className="flex items-center gap-1">
          {!isActive ? (
            <Button
              size="sm"
              onClick={startEncounter}
              disabled={encounter.combatants.length === 0}
              className="gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Start
            </Button>
          ) : (
            <>
              <Button size="icon-sm" variant="ghost" onClick={prevTurn} title="Previous turn (← or P)">
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={nextTurn}
                className="gap-1.5 bg-[var(--initiative)]/20 text-[var(--initiative)] border border-[var(--initiative)]/40 hover:bg-[var(--initiative)]/30"
                title="Next turn (→ or N)"
              >
                <SkipForward className="w-3.5 h-3.5" /> Next
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={endEncounter} title="End encounter">
                <Square className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button size="icon-sm" variant="ghost" onClick={resetRound} title="Reset">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1" />

        {/* Keyboard hints */}
        <p className="text-[9px] text-muted-foreground/60 hidden sm:block">
          <kbd className="px-0.5 rounded bg-muted border border-border text-[8px]">N</kbd>{" "}
          <kbd className="px-0.5 rounded bg-muted border border-border text-[8px]">P</kbd>{" "}
          <kbd className="px-0.5 rounded bg-muted border border-border text-[8px]">S</kbd>{" "}
          <kbd className="px-0.5 rounded bg-muted border border-border text-[8px]">A</kbd>{" "}
          <kbd className="px-0.5 rounded bg-muted border border-border text-[8px]">⌘S</kbd>
        </p>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
          className="gap-1.5 flex-none"
          title="Add combatant (A)"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      <AddCombatantDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
