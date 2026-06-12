"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { hpColor, hpPercent } from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Heart } from "lucide-react";

interface HPControlsProps {
  combatantId: string;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  compact?: boolean;
}

export function HPControls({ combatantId, hpCurrent, hpMax, hpTemp, compact = false }: HPControlsProps) {
  const { updateHP, setHP, setTempHP } = useEncounterStore();
  const [inputVal, setInputVal] = useState("");
  const [mode, setMode] = useState<"damage" | "heal" | "set">("damage");
  const [showTempInput, setShowTempInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pct = hpPercent(hpCurrent, hpMax);
  const color = hpColor(hpCurrent, hpMax);

  function applyInput() {
    const val = parseInt(inputVal, 10);
    if (isNaN(val) || val < 0) { setInputVal(""); return; }
    if (mode === "damage") updateHP(combatantId, -val);
    else if (mode === "heal") updateHP(combatantId, val);
    else setHP(combatantId, val);
    setInputVal("");
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") applyInput();
    if (e.key === "Escape") setInputVal("");
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <div className="relative w-24 h-5 bg-muted rounded overflow-hidden">
          <div
            className="hp-bar absolute inset-y-0 left-0 rounded"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            {hpCurrent}/{hpMax}
          </span>
        </div>
        {hpTemp > 0 && (
          <span className="text-xs text-blue-400 font-medium">+{hpTemp}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative h-6 bg-muted rounded overflow-hidden">
        <div
          className="hp-bar absolute inset-y-0 left-0 rounded"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-xs font-bold text-white drop-shadow flex items-center gap-1">
            <Heart className="w-3 h-3" />
            {hpCurrent}/{hpMax}
          </span>
          {hpTemp > 0 && (
            <span className="text-xs text-blue-300 font-medium">+{hpTemp} tmp</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <div className="flex rounded-md overflow-hidden border border-border text-xs">
          {(["damage", "heal", "set"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-2 py-1 capitalize transition-colors",
                mode === m
                  ? m === "damage"
                    ? "bg-red-900/60 text-red-200"
                    : m === "heal"
                    ? "bg-green-900/60 text-green-200"
                    : "bg-accent text-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <Input
          ref={inputRef}
          type="number"
          min="0"
          placeholder="0"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKey}
          className="h-7 w-16 text-center text-sm px-1"
        />

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={applyInput}
          className={cn(
            mode === "damage" && "text-red-400 hover:text-red-300",
            mode === "heal" && "text-green-400 hover:text-green-300"
          )}
        >
          {mode === "damage" ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        </Button>
      </div>

      <div className="flex gap-1">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => setShowTempInput((v) => !v)}>
          Temp HP
        </Button>
        {showTempInput && (
          <Input
            type="number"
            min="0"
            placeholder="0"
            defaultValue={hpTemp}
            className="h-6 w-16 text-xs px-1"
            onBlur={(e) => setTempHP(combatantId, parseInt(e.target.value, 10) || 0)}
          />
        )}
      </div>
    </div>
  );
}
