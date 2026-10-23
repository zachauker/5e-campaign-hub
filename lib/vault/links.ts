import type { VaultNote } from "./scan";

export interface ParsedWikilink {
  target: string;
  label: string | null;
  heading: string | null;
}

export interface LinkIndex {
  /** The note a link target points at, or `undefined` if nothing matches. */
  resolve(target: string): VaultNote | undefined;
}

/**
 * Parse one wikilink: `[[Name]]`, `[[Name|label]]`, `[[Name#heading]]`,
 * `[[Name#heading|label]]`, or the same without brackets (frontmatter often
 * omits them). Returns `null` when there is no target to link to.
 *
 * The first `|` splits off the label, then the first `#` of what remains splits
 * the heading from the target, so a `#` inside a label stays part of the label.
 * Every part is trimmed; an empty label or heading is `null`.
 */
export function parseWikilink(raw: string): ParsedWikilink | null {
  let inner = raw.trim();
  if (inner.startsWith("[[") && inner.endsWith("]]")) inner = inner.slice(2, -2);

  let label: string | null = null;
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    label = inner.slice(pipe + 1).trim() || null;
    inner = inner.slice(0, pipe);
  }

  let heading: string | null = null;
  const hash = inner.indexOf("#");
  if (hash !== -1) {
    heading = inner.slice(hash + 1).trim() || null;
    inner = inner.slice(0, hash);
  }

  const target = inner.trim();
  return target === "" ? null : { target, label, heading };
}

/**
 * The link targets in a frontmatter value: a string, an array of strings, or
 * absent. Frontmatter is hand-written, so anything else (and any non-string or
 * empty array entry) is skipped rather than thrown on.
 */
export function parseWikilinkList(value: unknown): string[] {
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const targets: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const link = parseWikilink(item);
    if (link) targets.push(link.target);
  }
  return targets;
}

function key(name: string): string {
  return name.trim().toLowerCase();
}

/** The `aliases:` frontmatter entries: plain strings (not wikilinks), indexed as-is. */
function aliasesOf(note: VaultNote): string[] {
  const value = note.data.aliases;
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return items.filter((item): item is string => typeof item === "string");
}

/**
 * Index notes by lowercased basename and by every alias. When several notes
 * claim the same key (duplicate basenames, a shared alias, or a basename that is
 * another note's alias) the note with the sorted-first `path` wins. Notes are
 * sorted by path before indexing, so the winner never depends on input order.
 */
export function buildLinkIndex(notes: VaultNote[]): LinkIndex {
  const sorted = [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const byKey = new Map<string, VaultNote>();
  for (const note of sorted) {
    for (const name of [note.basename, ...aliasesOf(note)]) {
      const k = key(name);
      if (k !== "" && !byKey.has(k)) byKey.set(k, note);
    }
  }
  return {
    resolve(target: string): VaultNote | undefined {
      return byKey.get(key(target));
    },
  };
}
