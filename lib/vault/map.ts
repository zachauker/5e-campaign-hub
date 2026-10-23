import { parseWikilink, parseWikilinkList } from "./links";
import { digestBody } from "./body";
import { parseDdbCharacterId } from "@/lib/ddb/character-id";
import type { VaultNote } from "./scan";

export type PropEntry = { label: string; value: string };

export type VaultEntityTable = "characters" | "locations" | "items" | "factions" | "sessionNotes";

export interface MappedEntity {
  sourceKey: string;
  sourcePath: string;
  name: string;
  archived: boolean;
  sourceProps: PropEntry[];
  sourceHash: string;
  sourceText: string;
  extra: Record<string, unknown>;
  /** Unresolved wikilink targets; the repos resolve them to hub ids. */
  factionTargets?: string[];
  locationTargets?: string[];
  heldByTargets?: string[];
  parentTarget?: string;
  settingNames?: string[];
}

// ─── Identity ────────────────────────────────────────────────────────────────

/** A frontmatter id: a non-empty string, or a number (an all-digit id parses as one). */
function idValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value.trim();
}

/**
 * `notion_id` is compared against `source_key`, which the migration backfills
 * from `notion_page_id` — always the dash-free form. Normalise a dashed UUID so
 * a vault written either way still adopts the existing row.
 */
function notionId(note: VaultNote): string | null {
  const id = idValue(note.data.notion_id);
  return id === null ? null : id.replace(/-/g, "");
}

/**
 * The key a note identifies as, and its tier: `hub_id` (1), then `notion_id`
 * (2, equal to the `notion_page_id` already in the live database), then the
 * basename (3, best-effort).
 */
export function resolveSourceKey(note: VaultNote): { key: string; tier: 1 | 2 | 3 } {
  const hub = idValue(note.data.hub_id);
  if (hub !== null) return { key: hub, tier: 1 };
  const notion = notionId(note);
  if (notion !== null) return { key: notion, tier: 2 };
  return { key: note.basename, tier: 3 };
}

/**
 * Every key the note could have been stored under, highest tier first
 * (`hub_id`, `notion_id`, basename), without duplicates. Promotion tries the
 * lower entries when the resolved key (the first entry present) misses.
 */
export function candidateKeys(note: VaultNote): string[] {
  const keys = [idValue(note.data.hub_id), notionId(note), note.basename];
  const out: string[] = [];
  for (const key of keys) {
    if (key !== null && !out.includes(key)) out.push(key);
  }
  return out;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

const TABLE_BY_TYPE: Record<string, VaultEntityTable> = {
  npc: "characters",
  pc: "characters",
  location: "locations",
  item: "items",
  faction: "factions",
  session: "sessionNotes",
  arc: "sessionNotes",
  encounter: "sessionNotes",
  scene: "sessionNotes",
};

// Real vault types that deliberately have no hub table.
const SKIPPED_TYPES = new Set(["thread", "player-note", "reference", "campaign"]);

export function tableForType(type: string | undefined): VaultEntityTable | "skip" | "unknown" {
  if (type === undefined) return "unknown";
  if (Object.hasOwn(TABLE_BY_TYPE, type)) return TABLE_BY_TYPE[type];
  return SKIPPED_TYPES.has(type) ? "skip" : "unknown";
}

// ─── Frontmatter readers (note.data is read-only: never write into it) ───────

/**
 * Normalise a frontmatter date to `YYYY-MM-DD`, or `null` when it is not one.
 * gray-matter turns an unquoted `2026-08-02` into a `Date` at UTC midnight, so a
 * `Date` is read with UTC accessors (local ones can shift the day). A string
 * must lead with a real calendar date; a trailing time is dropped.
 */
export function normalizeDate(value: unknown): string | null {
  let y: number, m: number, d: number;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    y = value.getUTCFullYear();
    m = value.getUTCMonth() + 1;
    d = value.getUTCDate();
  } else if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(value.trim());
    if (!match) return null;
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  } else {
    return null;
  }
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** A scalar (or list of scalars) as display text; anything else is "". */
function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  return "";
}

function pushIf(list: PropEntry[], label: string, value: string | number | null | undefined): void {
  if (value !== null && value !== undefined && String(value).length > 0) {
    list.push({ label, value: String(value) });
  }
}

/**
 * D&D Beyond character id from a sheet URL. Delegates to the same parser the
 * public-sheet fetcher uses, so the short `ddb.ac/characters/<id>/<slug>` links
 * half the party writes resolve exactly as the long form does.
 */
export function extractDdbId(url: string | null): string | null {
  return parseDdbCharacterId(url);
}

/** A link field's visible name: the label if it has one, else the target. */
function linkName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = parseWikilink(value);
  return link ? (link.label ?? link.target) : null;
}

const CATEGORY_NOTE_TYPES: Record<string, string> = {
  combat: "Combat Encounter",
  social: "RP Encounter",
  exploration: "Exploration Encounter",
};

/**
 * The hub's `note_type`, which the event map-pin icons read. `scene` is always
 * a Character Event: `type:` is the spotlight axis, `encounter_type` a separate
 * category axis that only `encounter` consults.
 */
function noteTypeFor(vaultType: string, category: string): string | null {
  switch (vaultType) {
    case "session": return "Session Notes";
    case "arc": return "Story Outline";
    case "scene": return "Character Event";
    case "encounter": return CATEGORY_NOTE_TYPES[category.toLowerCase()] ?? null;
    default: return null;
  }
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

/**
 * Translate a parsed note into a database-shaped entity. Never writes
 * `locations.type`: the hub enum stays world-authoritative and `location_type`
 * is a displayed property only. `description` is emitted only when non-empty so
 * a blank field cannot overwrite world-composed text.
 */
export function mapNote(note: VaultNote, table: VaultEntityTable): MappedEntity {
  const data = note.data;
  const props: PropEntry[] = [];
  const extra: Record<string, unknown> = {};
  const digest = digestBody(note.body);

  // Only characters and factions carry `active`; the other tables archive by
  // disappearing from the vault, which the sync handles.
  let archived = false;
  const entity: Partial<MappedEntity> = {};

  switch (table) {
    case "characters": {
      const sheetUrl = text(data.sheet) || null;
      const ddbCharacterId = extractDdbId(sheetUrl);
      pushIf(props, "Race", text(data.race));
      pushIf(props, "Class", text(data.class));
      pushIf(props, "Level", text(data.level));
      pushIf(props, "Disposition", text(data.disposition));
      pushIf(props, "Role", text(data.role));
      if (sheetUrl && !ddbCharacterId) pushIf(props, "Sheet", sheetUrl);
      archived = data.active === false;
      extra.type = data.type === "pc" ? "pc" : "npc";
      // Only when an id was actually read. `ddb_character_id` is hub-entered as
      // often as vault-derived, and `extra` is spread into the UPDATE, so
      // emitting null for an unrecognised (or absent) sheet would blank a
      // working D&D Beyond connection. Same guard shape as `description` below.
      if (ddbCharacterId !== null) extra.ddbCharacterId = ddbCharacterId;
      entity.factionTargets = parseWikilinkList(data.factions);
      entity.locationTargets = parseWikilinkList(data.location);
      break;
    }
    case "locations": {
      const parents = parseWikilinkList(data.parent);
      pushIf(props, "Type", text(data.location_type));
      pushIf(props, "Status", text(data.status));
      pushIf(props, "Region", text(data.region));
      pushIf(props, "Parent", parents.join(", "));
      const description = text(data.description);
      if (description) extra.description = description;
      if (parents.length > 0) entity.parentTarget = parents[0];
      break;
    }
    case "items": {
      pushIf(props, "Type", text(data.item_type));
      pushIf(props, "Rarity", text(data.rarity));
      const description = text(data.description);
      if (description) extra.description = description;
      entity.heldByTargets = parseWikilinkList(data.held_by);
      break;
    }
    case "factions": {
      pushIf(props, "Type", text(data.faction_type));
      pushIf(props, "Alignment", text(data.stance));
      pushIf(props, "Headquarters", parseWikilinkList(data.headquarters).join(", "));
      archived = data.active === false;
      break;
    }
    case "sessionNotes": {
      const vaultType = typeof data.type === "string" ? data.type : "";
      const category = text(data.encounter_type);
      const status = text(data.status) || null;
      const date = normalizeDate(data.date);
      const arc = linkName(data.arc);
      pushIf(props, "Session", text(data.session));
      pushIf(props, "Date", date);
      pushIf(props, "Status", status);
      pushIf(props, "Arc", arc);
      pushIf(props, "Category", category);
      pushIf(props, "Featuring", parseWikilinkList(data.featuring).join(", "));
      extra.noteType = noteTypeFor(vaultType, category);
      extra.status = status;
      extra.date = date;
      extra.arc = arc;
      entity.locationTargets = parseWikilinkList(data.locations);
      entity.settingNames = Array.isArray(data.settings)
        ? data.settings.map(text).filter(Boolean)
        : text(data.settings) ? [text(data.settings)] : [];
      break;
    }
  }

  return {
    sourceKey: resolveSourceKey(note).key,
    sourcePath: note.path,
    name: note.basename,
    archived,
    sourceProps: props,
    sourceHash: digest.hash,
    sourceText: digest.text,
    extra,
    ...entity,
  };
}
