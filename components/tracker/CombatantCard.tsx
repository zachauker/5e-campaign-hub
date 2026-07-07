"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { CombatantWithParsed } from "@/lib/types";
import { hpColor, hpPercent } from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { HPControls } from "./HPControls";
import { ConditionPicker, ConditionDisplay } from "./ConditionPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Shield,
  Eye,
  EyeOff,
  Trash2,
  BookOpen,
  GripVertical,
  Zap,
  User,
  Sword,
  AlertTriangle,
  Edit2,
} from "lucide-react";

interface CombatantCardProps {
  combatant: CombatantWithParsed;
  isActive: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

const TYPE_COLORS = {
  pc: "var(--hp-high)",
  npc: "var(--initiative)",
  monster: "var(--hp-low)",
};

const TYPE_ICONS = {
  pc: <User className="w-3 h-3" />,
  npc: <Zap className="w-3 h-3" />,
  monster: <Sword className="w-3 h-3" />,
};

export function CombatantCard({ combatant: c, isActive, dragHandleProps }: CombatantCardProps) {
  const {
    setInitiative,
    toggleConcentration,
    removeCombatant,
    showStatBlock,
    updateCombatant,
    selectCombatant,
    selectedCombatantId,
    syncErrors,
  } = useEncounterStore();

  const isSelected = selectedCombatantId === c.id;
  const isStale = c.type === "pc" && syncErrors.has(c.id);
  const [editingInit, setEditingInit] = useState(false);
  const [initVal, setInitVal] = useState(String(c.initiative ?? ""));
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(c.name);

  const pct = hpPercent(c.hpCurrent, c.hpMax);
  const color = hpColor(c.hpCurrent, c.hpMax);
  const typeColor = TYPE_COLORS[c.type];
  const isDead = c.hpCurrent <= 0 && c.hpMax > 0;

  // Fire the death-blow flash once, at the moment a combatant crosses to 0 HP.
  const [prevDead, setPrevDead] = useState(isDead);
  const [dying, setDying] = useState(false);
  if (isDead !== prevDead) {
    setPrevDead(isDead);
    if (isDead) setDying(true);
  }

  function commitInit() {
    const val = parseFloat(initVal);
    setInitiative(c.id, isNaN(val) ? null : val);
    setEditingInit(false);
  }

  function commitName() {
    if (nameVal.trim()) updateCombatant(c.id, { name: nameVal.trim() });
    setEditingName(false);
  }

  return (
    <div
      className={cn(
        "relative rounded-xl border transition-all duration-200 overflow-hidden",
        isActive && "combatant-active border-[var(--initiative)] bg-[var(--initiative)]/5",
        !isActive && "border-border",
        isDead && "opacity-40 [filter:grayscale(0.5)]",
        isSelected && !isActive && "border-muted-foreground",
        dying && "death-blow",
      )}
      onClick={() => selectCombatant(isSelected ? null : c.id)}
      onAnimationEnd={(e) => {
        if (e.animationName === "death-blow") setDying(false);
      }}
    >
      {/* HP bar strip — 6px, color-coded */}
      {c.hpMax > 0 && (
        <div className="h-1.5 bg-muted/60">
          <div
            className="hp-bar h-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      )}

      <div className="p-3">
        {/* Header row */}
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <div
            {...dragHandleProps}
            className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none flex-none"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Initiative */}
          <div className="flex-none">
            {editingInit ? (
              <Input
                autoFocus
                type="number"
                value={initVal}
                onChange={(e) => setInitVal(e.target.value)}
                onBlur={commitInit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitInit();
                  if (e.key === "Escape") setEditingInit(false);
                }}
                className="w-12 h-10 text-center text-base font-bold px-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingInit(true);
                  setInitVal(String(c.initiative ?? ""));
                }}
                className={cn(
                  "w-12 h-10 flex items-center justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-[var(--initiative)]/20"
                    : "bg-muted hover:bg-accent"
                )}
                title="Set initiative"
              >
                <span
                  className={cn(
                    "text-base font-bold tabular-nums",
                    isActive ? "text-[var(--initiative)]" : "text-foreground"
                  )}
                >
                  {c.initiative ?? "—"}
                </span>
              </button>
            )}
          </div>

          {/* Avatar */}
          <div className="relative flex-none">
            {c.avatarUrl ? (
              <img
                src={c.avatarUrl}
                alt={c.name}
                className="w-9 h-9 rounded-full object-cover border border-border"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-full border flex items-center justify-center text-muted-foreground"
                style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}44` }}
              >
                {TYPE_ICONS[c.type]}
              </div>
            )}
            {/* Stale-data badge: this PC's last D&D Beyond sync failed */}
            {isStale && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-warning text-black ring-2 ring-card cursor-help"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[14rem]">
                  <p className="font-semibold text-warning">Stale data</p>
                  <p className="text-muted-foreground leading-snug">
                    Last D&amp;D Beyond sync failed — HP and slots may be out of date.
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Name & type */}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <Input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="h-7 text-sm font-semibold px-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div>
                <div className="group/name flex items-center gap-1">
                  <button
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingName(true);
                      setNameVal(c.name);
                    }}
                    className={cn(
                      "text-sm font-semibold truncate text-left transition-colors min-w-0",
                      isActive
                        ? "text-[var(--initiative)]"
                        : "text-foreground hover:text-primary",
                      isDead && "line-through text-muted-foreground"
                    )}
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingName(true);
                      setNameVal(c.name);
                    }}
                    title="Rename"
                    aria-label="Rename combatant"
                    className="flex-none text-muted-foreground/50 hover:text-foreground opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100 transition-opacity"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  {isActive && (
                    <span className="flex-none w-1.5 h-1.5 rounded-full bg-[var(--initiative)] animate-pulse" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="text-[10px] font-medium capitalize flex items-center gap-0.5"
                    style={{ color: typeColor }}
                  >
                    {TYPE_ICONS[c.type]} {c.type}
                  </span>
                  {c.playerName && (
                    <span className="text-[10px] text-muted-foreground">· {c.playerName}</span>
                  )}
                  {c.isConcentrating && (
                    <span className="text-[10px] text-concentration font-medium">· Conc</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AC */}
          <div className="flex-none flex flex-col items-center gap-0.5">
            <Shield className="w-3 h-3 text-muted-foreground" />
            <span className="text-sm font-bold leading-none">{c.ac}</span>
          </div>

          {/* HP */}
          <div className="flex-none" onClick={(e) => e.stopPropagation()}>
            <HPControls
              combatantId={c.id}
              hpCurrent={c.hpCurrent}
              hpMax={c.hpMax}
              hpTemp={c.hpTemp}
              compact={true}
            />
          </div>
        </div>

        {/* Conditions in header */}
        {c.conditions.length > 0 && (
          <div className="mt-1.5 pl-[4.25rem]">
            <ConditionDisplay conditions={c.conditions} compact />
          </div>
        )}

        {/* Expanded panel */}
        {isSelected && (
          <div
            className="mt-3 pt-3 border-t border-border space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <HPControls
              combatantId={c.id}
              hpCurrent={c.hpCurrent}
              hpMax={c.hpMax}
              hpTemp={c.hpTemp}
            />

            <ConditionPicker combatantId={c.id} conditions={c.conditions}>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full">
                <span>Conditions</span>
                {c.conditions.length > 0 && (
                  <span className="text-muted-foreground">({c.conditions.length})</span>
                )}
              </Button>
            </ConditionPicker>

            <div className="flex gap-1 flex-wrap">
              <Button
                size="sm"
                variant={c.isConcentrating ? "initiative" : "ghost"}
                className="h-7 text-xs"
                onClick={() => toggleConcentration(c.id)}
              >
                Concentration
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => updateCombatant(c.id, { isVisible: !c.isVisible })}
              >
                {c.isVisible ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
                {c.isVisible ? "Visible" : "Hidden"}
              </Button>
              {(c.statBlock || c.ddbCharacter) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => showStatBlock(c.id)}
                >
                  <BookOpen className="w-3 h-3 mr-1" />
                  {c.ddbCharacter ? "Sheet" : "Stat Block"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${c.name}`}
                title={`Remove ${c.name}`}
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => removeCombatant(c.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>

            {c.notes !== null && (
              <textarea
                className="w-full bg-muted rounded-md border border-border text-xs p-2 resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Notes…"
                aria-label={`Notes for ${c.name}`}
                rows={2}
                defaultValue={c.notes ?? ""}
                onBlur={(e) => useEncounterStore.getState().setNotes(c.id, e.target.value)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
