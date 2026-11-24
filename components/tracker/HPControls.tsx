"use client";

import React, { useState, useRef } from "react";
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
  /** Shown beside the HP in the `vitals` variant, so AC and HP read as one box. */
  ac?: number;
  variant?: "full" | "compact" | "vitals";
}

export function HPControls({ combatantId, hpCurrent, hpMax, hpTemp, ac, variant = "full" }: HPControlsProps) {
  const { updateHP, setHP, setTempHP } = useEncounterStore();
  const [inputVal, setInputVal] = useState("");
  const [mode, setMode] = useState<"damage" | "heal" | "set">("damage");
  const [editing, setEditing] = useState(false);
  const [showTempInput, setShowTempInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Floating damage/heal number: capture the HP delta during render (React's
  // adjust-state-on-change pattern, guarded so it fires once per change) and let
  // it rise from the always-visible header display (compact bar or vitals box).
  // The expanded "full" panel sits right under the header, so it doesn't repeat it.
  const [prevHp, setPrevHp] = useState(hpCurrent);
  const [floater, setFloater] = useState<{ delta: number; seq: number } | null>(null);
  if (hpCurrent !== prevHp) {
    const delta = hpCurrent - prevHp;
    setPrevHp(hpCurrent);
    if (delta !== 0) setFloater((f) => ({ delta, seq: (f?.seq ?? 0) + 1 }));
  }

  const pct = hpPercent(hpCurrent, hpMax);
  const color = hpColor(hpCurrent, hpMax);

  const closingRef = useRef(false);

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

  const floaterEl = floater && (
    <span
      key={floater.seq}
      onAnimationEnd={() => setFloater(null)}
      aria-hidden
      className={cn(
        "hp-float pointer-events-none absolute left-12 -top-1 z-10 text-xs font-bold tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]",
        floater.delta < 0 ? "text-damage" : "text-heal"
      )}
    >
      {floater.delta < 0 ? floater.delta : `+${floater.delta}`}
    </span>
  );

  if (variant === "vitals") {
    const labelCls = "text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground";
    const nudgeCls =
      "w-7 h-[21px] flex items-center justify-center rounded-[7px] border border-border bg-muted text-foreground/90 hover:bg-accent transition-colors";
    return (
      <div className="relative flex items-center gap-3.5 rounded-[10px] border border-border bg-[oklch(0.185_0.014_46)] px-3 py-1.5">
        <div className="flex flex-col items-center min-w-8">
          <span className={labelCls}>AC</span>
          <span className="text-xl font-bold leading-[1.1] tabular-nums">{ac}</span>
        </div>
        <div className="w-px self-stretch bg-border" />
        <div className="flex flex-col items-center min-w-[4.5rem]">
          <span className={labelCls}>HP</span>
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                type="number"
                min="0"
                placeholder="0"
                aria-label={mode === "damage" ? "Damage amount" : mode === "heal" ? "Healing amount" : "Set HP to"}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { closingRef.current = true; applyInput(); setEditing(false); }
                  if (e.key === "Escape") { closingRef.current = true; setInputVal(""); setEditing(false); }
                }}
                // Clicking away applies what was typed (type 14, click the next target); Escape is the cancel.
                // closingRef stops Enter/Escape applying twice when unmounting the input also fires blur.
                onBlur={() => {
                  if (!closingRef.current && inputVal.trim() !== "") applyInput();
                  closingRef.current = false;
                  setInputVal("");
                  setEditing(false);
                }}
                className="h-7 w-14 text-center text-sm px-1"
              />
              {(["damage", "heal", "set"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  // keep focus in the input so choosing a mode doesn't close the editor
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode(m)}
                  aria-label={m}
                  title={m}
                  className={cn(
                    "h-7 w-6 rounded text-[11px] font-bold uppercase transition-colors",
                    mode === m
                      ? m === "damage"
                        ? "bg-damage/20 text-damage"
                        : m === "heal"
                        ? "bg-heal/20 text-heal"
                        : "bg-accent text-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {m[0]}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { closingRef.current = false; setMode("damage"); setEditing(true); }}
              title="Click to apply damage, healing or set HP"
              aria-label={`HP ${hpCurrent} of ${hpMax}. Edit`}
              className="text-xl font-bold leading-[1.1] tabular-nums rounded hover:bg-accent/60 transition-colors"
            >
              <span style={{ color }}>{hpCurrent}</span>
              <span className="text-sm font-bold text-muted-foreground">/{hpMax}</span>
              {hpTemp > 0 && (
                <span className="ml-1 text-xs font-medium text-temp-hp">+{hpTemp}</span>
              )}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-[3px]">
          <button
            type="button"
            onClick={() => updateHP(combatantId, 1)}
            aria-label="Heal 1"
            title="Heal 1"
            className={nudgeCls}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => updateHP(combatantId, -1)}
            aria-label="Damage 1"
            title="Damage 1"
            className={nudgeCls}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
        {floaterEl}
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="relative flex items-center gap-1">
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
          <span className="text-xs text-temp-hp font-medium">+{hpTemp}</span>
        )}
        {floaterEl}
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
          <span className="text-xs font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1">
            <Heart className="w-3 h-3" />
            {hpCurrent}/{hpMax}
          </span>
          {hpTemp > 0 && (
            <span className="text-xs text-temp-hp font-medium">+{hpTemp} tmp</span>
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
                    ? "bg-damage/20 text-damage"
                    : m === "heal"
                    ? "bg-heal/20 text-heal"
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
          aria-label={mode === "damage" ? "Damage amount" : mode === "heal" ? "Healing amount" : "Set HP to"}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKey}
          className="h-7 w-16 text-center text-sm px-1"
        />

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={applyInput}
          aria-label={mode === "damage" ? "Apply damage" : mode === "heal" ? "Apply healing" : "Set HP"}
          title={mode === "damage" ? "Apply damage" : mode === "heal" ? "Apply healing" : "Set HP"}
          className={cn(
            mode === "damage" && "text-damage",
            mode === "heal" && "text-heal"
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
            aria-label="Temporary HP"
            defaultValue={hpTemp}
            className="h-6 w-16 text-xs px-1"
            onBlur={(e) => setTempHP(combatantId, parseInt(e.target.value, 10) || 0)}
          />
        )}
      </div>
    </div>
  );
}
