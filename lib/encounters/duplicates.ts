import type { CombatantWithParsed } from "@/lib/types";

/**
 * Token colours for telling identical creatures apart. All are light enough for
 * dark badge text (>= 6:1 against #111) and read well on the dark theme. None
 * is green, amber, red or gold: those hues already mean health (--hp-high,
 * --hp-med, --hp-low) and whose turn it is (--initiative).
 */
export const TOKEN_PALETTE: readonly string[] = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
  "#cbd5e1", // silver
  "#818cf8", // indigo
];

const TRAILING_ORDINAL = /\s+(\d+)$/;

/** The name with a trailing ordinal stripped: "Goblin 2" becomes "Goblin". */
export function baseName(name: string): string {
  return name.replace(TRAILING_ORDINAL, "");
}

function ordinalOf(name: string): number | null {
  const match = TRAILING_ORDINAL.exec(name);
  return match ? Number(match[1]) : null;
}

/** What makes two combatants copies of one another. */
export function sourceKeyOf(
  c: Pick<CombatantWithParsed, "monsterSlug" | "characterId" | "name">,
): string {
  return c.monsterSlug ?? c.characterId ?? baseName(c.name);
}

/** True when the DM has given a copy a name unrelated to its source. */
export function isRenamedByHand(currentName: string, sourceName: string): boolean {
  return baseName(currentName) !== baseName(sourceName);
}

function bySortOrder(a: CombatantWithParsed, b: CombatantWithParsed): number {
  return a.sortOrder - b.sortOrder;
}

/** Groups of 2+ combatants sharing a source, members in sortOrder. */
export function duplicateGroups(
  combatants: CombatantWithParsed[],
): Map<string, CombatantWithParsed[]> {
  const all = new Map<string, CombatantWithParsed[]>();
  for (const c of [...combatants].sort(bySortOrder)) {
    const key = sourceKeyOf(c);
    const group = all.get(key);
    if (group) group.push(c);
    else all.set(key, [c]);
  }
  for (const [key, group] of all) {
    if (group.length < 2) all.delete(key);
  }
  return all;
}

/**
 * Badge numbers for a group, in group order. A number read from a name wins, so
 * removing Goblin 2 of 3 leaves 1 and 3 rather than silently renumbering. A
 * member whose name carries none takes the lowest number no named member holds,
 * so two badges in a group never read the same.
 */
function groupIndices(group: CombatantWithParsed[]): number[] {
  const claimed = new Set<number>();
  for (const c of group) {
    const n = ordinalOf(c.name);
    if (n !== null) claimed.add(n);
  }
  let candidate = 1;
  return group.map((c) => {
    const named = ordinalOf(c.name);
    if (named !== null) return named;
    while (claimed.has(candidate)) candidate += 1;
    claimed.add(candidate);
    return candidate;
  });
}

/** The badge number for a combatant, or null when it has no duplicate. */
export function tokenIndexOf(
  combatants: CombatantWithParsed[],
  id: string,
): number | null {
  for (const group of duplicateGroups(combatants).values()) {
    const position = group.findIndex((c) => c.id === id);
    if (position !== -1) return groupIndices(group)[position];
  }
  return null;
}

function colorFor(index: number): string {
  return TOKEN_PALETTE[(index - 1) % TOKEN_PALETTE.length];
}

/** What the add path applies for a newly added copy of a creature. */
export function planAdd(
  existing: CombatantWithParsed[],
  incoming: { name: string; sourceKey: string; sourceName: string },
): {
  name: string;
  color: string;
  renameFirst: { id: string; name: string; color: string } | null;
} {
  const matches = existing
    .filter((c) => sourceKeyOf(c) === incoming.sourceKey)
    .sort(bySortOrder);

  if (matches.length === 0) {
    return { name: incoming.name, color: colorFor(1), renameFirst: null };
  }

  const next = Math.max(...groupIndices(matches)) + 1;

  const [only] = matches;
  const renameFirst =
    matches.length === 1 &&
    ordinalOf(only.name) === null &&
    !isRenamedByHand(only.name, incoming.sourceName)
      ? { id: only.id, name: `${incoming.sourceName} 1`, color: colorFor(1) }
      : null;

  return {
    name: `${incoming.sourceName} ${next}`,
    color: colorFor(next),
    renameFirst,
  };
}
