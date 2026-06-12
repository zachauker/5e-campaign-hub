"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CombatantWithParsed } from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { CombatantCard } from "./CombatantCard";
import { ScrollArea } from "@/components/ui/scroll-area";

export function InitiativeTracker() {
  const { encounter, reorderCombatants } = useEncounterStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<CombatantWithParsed | null>(null);
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const prevActiveId = useRef<string | null>(null);

  // Scroll the active combatant into view when the turn advances
  useEffect(() => {
    const currentId = encounter?.currentCombatantId;
    if (currentId && currentId !== prevActiveId.current) {
      prevActiveId.current = currentId;
      activeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [encounter?.currentCombatantId]);

  if (!encounter) return null;

  const sorted = [...encounter.combatants].sort((a, b) => a.sortOrder - b.sortOrder);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragItemRef.current = sorted[idx];
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(idx);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    const items = [...sorted];
    const [moved] = items.splice(dragIndex, 1);
    items.splice(idx, 0, moved);
    reorderCombatants(items);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
    dragItemRef.current = null;
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1.5">
        {sorted.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm font-medium">No combatants in this encounter.</p>
            <p className="text-xs mt-1 text-muted-foreground/60">
              Add monsters, NPCs, or import characters from D&amp;D Beyond.
            </p>
          </div>
        )}
        {sorted.map((combatant, idx) => {
          const isActive = encounter.currentCombatantId === combatant.id;
          return (
            <div
              key={combatant.id}
              ref={isActive ? activeCardRef : undefined}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "transition-transform duration-150",
                dragIndex === idx && "combatant-dragging",
                overIndex === idx && dragIndex !== idx && "translate-y-0.5"
              )}
            >
              <CombatantCard
                combatant={combatant}
                isActive={isActive}
                dragHandleProps={{
                  onMouseDown: (e) => e.stopPropagation(),
                }}
              />
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
