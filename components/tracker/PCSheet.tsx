"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { parseModifier, type DDBCharacter } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PCSheetProps {
  char: DDBCharacter;
  className?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground block leading-none mb-0.5">
      {children}
    </span>
  );
}

function Divider() {
  return <div className="border-t border-border/60 my-3" />;
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center bg-muted rounded-lg py-1.5 px-1 min-w-0">
      <Label>{label}</Label>
      <span
        className={cn(
          "text-base font-bold leading-none",
          accent && "text-[var(--initiative)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ability score row
// ---------------------------------------------------------------------------

const ABILITIES = [
  { key: "str" as const, label: "STR" },
  { key: "dex" as const, label: "DEX" },
  { key: "con" as const, label: "CON" },
  { key: "int" as const, label: "INT" },
  { key: "wis" as const, label: "WIS" },
  { key: "cha" as const, label: "CHA" },
];

function AbilityRow({ stats }: { stats: DDBCharacter["stats"] }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {ABILITIES.map(({ key, label }) => (
        <div key={key} className="flex flex-col items-center bg-muted rounded-md py-1.5">
          <Label>{label}</Label>
          <span className="text-xs font-bold leading-none">{stats[key]}</span>
          <span className="text-[10px] text-[var(--initiative)] leading-none mt-0.5">
            {parseModifier(stats[key])}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saving throws — only show proficient ones prominently, rest dimmed
// ---------------------------------------------------------------------------

const SAVE_LABELS: Record<string, string> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};

function SavingThrows({ saves }: { saves: DDBCharacter["savingThrows"] }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
      {Object.entries(saves).map(([stat, data]) => (
        <div
          key={stat}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            !data.proficient && "opacity-40"
          )}
        >
          <span
            className={cn(
              "w-2 h-2 rounded-full border flex-none",
              data.proficient
                ? "bg-[var(--initiative)] border-[var(--initiative)]"
                : "border-muted-foreground"
            )}
          />
          <span className="font-medium w-6">{SAVE_LABELS[stat]}</span>
          <span className={cn("font-bold ml-auto", data.proficient && "text-[var(--initiative)]")}>
            {data.total >= 0 ? `+${data.total}` : data.total}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills — only proficient / expertise ones
// ---------------------------------------------------------------------------

const SKILL_DISPLAY: Record<string, string> = {
  "acrobatics": "Acrobatics",
  "animal-handling": "Animal Handling",
  "arcana": "Arcana",
  "athletics": "Athletics",
  "deception": "Deception",
  "history": "History",
  "insight": "Insight",
  "intimidation": "Intimidation",
  "investigation": "Investigation",
  "medicine": "Medicine",
  "nature": "Nature",
  "perception": "Perception",
  "performance": "Performance",
  "persuasion": "Persuasion",
  "religion": "Religion",
  "sleight-of-hand": "Sleight of Hand",
  "stealth": "Stealth",
  "survival": "Survival",
};

function ProficientSkills({ skills }: { skills: DDBCharacter["skills"] }) {
  const proficient = Object.entries(skills)
    .filter(([, d]) => d.proficient)
    .sort(([a], [b]) => a.localeCompare(b));

  if (proficient.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
      {proficient.map(([key, data]) => (
        <div key={key} className="flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "w-2 h-2 rounded-full border flex-none",
              data.expertise
                ? "bg-[var(--initiative)] border-[var(--initiative)]"
                : "bg-[var(--hp-high)] border-[var(--hp-high)]"
            )}
          />
          <span className="truncate">{SKILL_DISPLAY[key] ?? key}</span>
          <span className="font-bold ml-auto">
            {data.total >= 0 ? `+${data.total}` : data.total}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spell slots
// ---------------------------------------------------------------------------

function SpellSlots({
  slots,
  dc,
  bonus,
  ability,
}: {
  slots: NonNullable<DDBCharacter["spellSlots"]>;
  dc?: number;
  bonus?: number;
  ability?: string;
}) {
  const entries = Object.entries(slots)
    .map(([lvl, s]) => ({ level: Number(lvl), ...s }))
    .sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-1.5">
      {(dc || bonus || ability) && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {ability && <span className="uppercase font-semibold text-foreground">{ability}</span>}
          {dc && <span>DC <strong className="text-foreground">{dc}</strong></span>}
          {bonus != null && <span>+<strong className="text-foreground">{bonus}</strong> to hit</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {entries.map(({ level, max, used }) => {
          const remaining = max - used;
          return (
            <div key={level} className="flex flex-col items-center bg-muted rounded-lg px-2 py-1.5 min-w-[36px]">
              <Label>Lv {level}</Label>
              <span className={cn("text-sm font-bold leading-none", remaining === 0 && "text-muted-foreground line-through")}>
                {remaining}
              </span>
              <span className="text-[9px] text-muted-foreground">/{max}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Class resources (Rage, Ki, etc.) — pip display
// ---------------------------------------------------------------------------

function ClassResources({ resources }: { resources: NonNullable<DDBCharacter["classResources"]> }) {
  return (
    <div className="space-y-1">
      {resources.map((res, i) => {
        const remaining = res.max - res.used;
        // For large pools (>10), just show numbers
        const usePips = res.max <= 10;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-muted-foreground">{res.name}</span>
            {usePips ? (
              <div className="flex gap-0.5">
                {Array.from({ length: res.max }).map((_, j) => (
                  <span
                    key={j}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full border",
                      j < remaining
                        ? "bg-[var(--initiative)] border-[var(--initiative)]"
                        : "border-muted-foreground"
                    )}
                  />
                ))}
              </div>
            ) : (
              <span className="font-bold">{remaining}/{res.max}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

function Attacks({ attacks }: { attacks: NonNullable<DDBCharacter["attacks"]> }) {
  return (
    <div className="space-y-1">
      {attacks.map((atk, i) => (
        <div key={i} className="flex items-center gap-2 text-xs bg-muted rounded-md px-2 py-1.5">
          <span className="flex-1 font-medium truncate">{atk.name}</span>
          <span className="text-[var(--initiative)] font-bold shrink-0">
            {atk.toHit != null ? (atk.toHit >= 0 ? `+${atk.toHit}` : atk.toHit) : "—"}
          </span>
          <span className="text-muted-foreground shrink-0">
            {atk.damageRoll ?? "—"}
            {atk.damageType ? ` ${atk.damageType}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — single-panel quick reference
// ---------------------------------------------------------------------------

export function PCSheet({ char, className }: PCSheetProps) {
  const hasSpellSlots = char.spellSlots && Object.keys(char.spellSlots).length > 0;
  const hasResources = char.classResources && char.classResources.length > 0;
  const hasAttacks = char.attacks && char.attacks.length > 0;
  const hasProficientSkills = char.skills && Object.values(char.skills).some((s) => s.proficient);

  const initStr = char.initiativeBonus >= 0 ? `+${char.initiativeBonus}` : `${char.initiativeBonus}`;

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="p-3 space-y-0">

        {/* Identity header */}
        <div className="flex items-center gap-2.5 mb-3">
          {char.avatarUrl && (
            <img
              src={char.avatarUrl}
              alt={char.name}
              className="w-10 h-10 rounded-full object-cover border-2 border-[var(--initiative)] shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight truncate">{char.name}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {char.classes
                ?.map((c) => `${c.name}${c.subclass ? ` (${c.subclass})` : ""} ${c.level}`)
                .join(" / ")}
            </p>
            {char.race && (
              <p className="text-[11px] text-muted-foreground leading-tight">
                {char.race}{char.background ? ` · ${char.background}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Core combat numbers */}
        <div className="grid grid-cols-5 gap-1 mb-3">
          <StatPill label="HP" value={char.maxHp} />
          <StatPill label="AC" value={char.ac} accent />
          <StatPill label="Init" value={initStr} />
          <StatPill label="Speed" value={`${char.speed}ft`} />
          <StatPill label="Prof" value={`+${char.proficiencyBonus}`} />
        </div>

        {/* Ability scores */}
        <AbilityRow stats={char.stats} />

        {/* Passive senses */}
        <div className="flex gap-2 mt-2">
          <div className="flex-1 bg-muted rounded-md px-2 py-1.5 text-center">
            <Label>Passive Perception</Label>
            <span className="text-sm font-bold">{char.passivePerception}</span>
          </div>
          {char.passiveInsight != null && (
            <div className="flex-1 bg-muted rounded-md px-2 py-1.5 text-center">
              <Label>Passive Insight</Label>
              <span className="text-sm font-bold">{char.passiveInsight}</span>
            </div>
          )}
          {char.passiveInvestigation != null && (
            <div className="flex-1 bg-muted rounded-md px-2 py-1.5 text-center">
              <Label>Passive Investigation</Label>
              <span className="text-sm font-bold">{char.passiveInvestigation}</span>
            </div>
          )}
        </div>

        {char.savingThrows && (
          <>
            <Divider />
            <Label>Saving Throws</Label>
            <SavingThrows saves={char.savingThrows} />
          </>
        )}

        {hasProficientSkills && char.skills && (
          <>
            <Divider />
            <Label>Proficient Skills</Label>
            <ProficientSkills skills={char.skills} />
          </>
        )}

        {hasAttacks && char.attacks && (
          <>
            <Divider />
            <Label>Attacks</Label>
            <Attacks attacks={char.attacks} />
          </>
        )}

        {hasSpellSlots && char.spellSlots && (
          <>
            <Divider />
            <Label>Spell Slots</Label>
            <SpellSlots
              slots={char.spellSlots}
              dc={char.spellSaveDC}
              bonus={char.spellAttackBonus}
              ability={char.spellcastingAbility}
            />
          </>
        )}

        {hasResources && char.classResources && (
          <>
            <Divider />
            <Label>Class Resources</Label>
            <ClassResources resources={char.classResources} />
          </>
        )}

      </div>
    </ScrollArea>
  );
}
