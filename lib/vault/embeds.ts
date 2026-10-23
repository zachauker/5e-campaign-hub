import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  characters, items, locations, sessionNotes,
  characterFactions, characterItems, characterLocations, sessionNoteLocations,
} from "@/lib/db/schema";

type Db = BetterSQLite3Database<Record<string, unknown>>;

/**
 * The views of `_Bases/Related.base` the hub can answer from its own tables.
 * The vault's `![[Related.base#<view>]]` embeds are Obsidian live queries the
 * hub cannot run; these six it answers from relations it already holds.
 */
export type EmbedView =
  | "npcs-here" | "members" | "items-held" | "sessions-here" | "content-here" | "places-within";

/** What a result row links to. Encounters and scenes are session_notes rows, so they are "session". */
export type EmbedItemKind = "character" | "item" | "session" | "location";

export interface EmbedResult {
  /** The list's heading: the canonical view name, regardless of how the DM typed it. */
  title: string;
  items: Array<{ kind: EmbedItemKind; id: string; name: string }>;
}

/** Heading (lowercased) -> view. Only the six answerable views appear here. */
const VIEW_BY_HEADING: Record<string, EmbedView> = {
  "npcs here": "npcs-here",
  "members": "members",
  "items held": "items-held",
  "sessions here": "sessions-here",
  "content here": "content-here",
  "places within": "places-within",
};

/**
 * The four views deliberately absent from the table above resolve to null:
 * `Threads` and `Threads advanced` point at `type: thread` (not mirrored by the
 * vault sync), `Scenes featuring` needs a session-note <-> character table that
 * does not exist, and `Items found` needs an item `found_in` that has no table.
 * null means "the renderer draws nothing", same as an unrecognised heading.
 */
export function embedViewFor(heading: string): EmbedView | null {
  // hasOwn, not a bare index: hand-typed headings like "constructor" or
  // "__proto__" must not resolve through Object.prototype (same guard as
  // tableForType in map.ts). A throw here would break the whole page render.
  const key = heading.trim().toLowerCase();
  return Object.hasOwn(VIEW_BY_HEADING, key) ? VIEW_BY_HEADING[key] : null;
}

/** Canonical heading and the one host kind each view is asked of. */
const VIEW_META: Record<EmbedView, { title: string; hostKind: string }> = {
  "npcs-here": { title: "NPCs here", hostKind: "location" },
  "members": { title: "Members", hostKind: "faction" },
  "items-held": { title: "Items held", hostKind: "character" },
  "sessions-here": { title: "Sessions here", hostKind: "location" },
  "content-here": { title: "Content here", hostKind: "location" },
  "places-within": { title: "Places within", hostKind: "location" },
};

/** `note_type` labels for encounters and scenes (see the vault type -> label table in map.ts). */
const CONTENT_NOTE_TYPES = [
  "Combat Encounter", "RP Encounter", "Exploration Encounter", "Character Event",
];

/**
 * Answer one base embed from the hub's relations. Archived rows never appear.
 * A host of the wrong kind for the view (`Members` pasted on a location, ...)
 * yields an empty list, never an error: the DM can paste an embed anywhere and
 * a throw would break the whole page render.
 */
export function resolveEmbed(
  db: Db, campaignId: string, view: EmbedView, hostKind: string, hostId: string,
): EmbedResult {
  const { title, hostKind: expectedHost } = VIEW_META[view];
  const empty: EmbedResult = { title, items: [] };
  if (hostKind !== expectedHost) return empty;

  switch (view) {
    case "npcs-here": {
      const rows = db.select({ id: characters.id, name: characters.name })
        .from(characterLocations)
        .innerJoin(characters, eq(characters.id, characterLocations.characterId))
        .where(and(
          eq(characterLocations.locationId, hostId),
          eq(characters.campaignId, campaignId),
          eq(characters.type, "npc"),
          eq(characters.archived, false),
        ))
        .orderBy(sql`lower(${characters.name})`, characters.id).all();
      return { title, items: rows.map((r) => ({ kind: "character", ...r })) };
    }
    case "members": {
      const rows = db.select({ id: characters.id, name: characters.name })
        .from(characterFactions)
        .innerJoin(characters, eq(characters.id, characterFactions.characterId))
        .where(and(
          eq(characterFactions.factionId, hostId),
          eq(characters.campaignId, campaignId),
          eq(characters.archived, false),
        ))
        .orderBy(sql`lower(${characters.name})`, characters.id).all();
      return { title, items: rows.map((r) => ({ kind: "character", ...r })) };
    }
    case "items-held": {
      const rows = db.select({ id: items.id, name: items.name })
        .from(characterItems)
        .innerJoin(items, eq(items.id, characterItems.itemId))
        .where(and(
          eq(characterItems.characterId, hostId),
          eq(items.campaignId, campaignId),
          eq(items.archived, false),
        ))
        .orderBy(sql`lower(${items.name})`, items.id).all();
      return { title, items: rows.map((r) => ({ kind: "item", ...r })) };
    }
    case "sessions-here":
    case "content-here": {
      // Both read session_note_locations; they differ only in which note_type
      // labels they keep. content-here is an explicit allow-list on purpose, so
      // Session Notes, Story Outline (arcs) and NULL note_type all stay out.
      //
      // The NULL gap: session_notes is dual-fed (the vault sync and the Notion
      // sync), and the Notion sync can leave note_type blank or unrecognised.
      // A deny-list ("anything but Session Notes / Story Outline") would admit
      // every such Notion row linked to a location as "content", which is far
      // likelier and plainly wrong. The accepted cost is the converse: an R20
      // encounter whose encounter_type did not map to a label has a NULL
      // note_type and is omitted. The proper fix, if that ever bites, is a
      // source discriminator on the row, not a looser note_type filter. Once
      // the Notion sync is removed the table becomes vault-only and this
      // trade should be revisited.
      const typeFilter = view === "sessions-here"
        ? eq(sessionNotes.noteType, "Session Notes")
        : inArray(sessionNotes.noteType, CONTENT_NOTE_TYPES);
      const q = db.select({ id: sessionNotes.id, name: sessionNotes.name })
        .from(sessionNoteLocations)
        .innerJoin(sessionNotes, eq(sessionNotes.id, sessionNoteLocations.sessionNoteId))
        .where(and(
          eq(sessionNoteLocations.locationId, hostId),
          eq(sessionNotes.campaignId, campaignId),
          eq(sessionNotes.archived, false),
          typeFilter,
        ));
      // Sessions: newest first (ISO dates sort lexically), undated last.
      // Content: alphabetical.
      const rows = view === "sessions-here"
        ? q.orderBy(sql`${sessionNotes.date} is null`, desc(sessionNotes.date), sql`lower(${sessionNotes.name})`, sessionNotes.id).all()
        : q.orderBy(sql`lower(${sessionNotes.name})`, sessionNotes.id).all();
      return { title, items: rows.map((r) => ({ kind: "session", ...r })) };
    }
    case "places-within": {
      const rows = db.select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(
          eq(locations.parentLocationId, hostId),
          eq(locations.campaignId, campaignId),
          eq(locations.archived, false),
        ))
        .orderBy(sql`lower(${locations.name})`, locations.id).all();
      return { title, items: rows.map((r) => ({ kind: "location", ...r })) };
    }
  }
}
