import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  characters, items, factions, characterFactions, characterItems, locations, characterLocations,
  sessionNotes, sessionNoteLocations,
} from "@/lib/db/schema";
import type { EntityRepo, EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type SyncTable = typeof characters | typeof items | typeof factions | typeof locations | typeof sessionNotes;

/**
 * Maps a wikilink target (a note basename) to the `source_key` of the note it
 * points at. Built once per scan by the sync (basename -> note via the link
 * index -> that note's key); the linkers call it on each target and then look
 * the resulting key up. Returning undefined skips the target.
 */
export type ResolveTargetToKey = (target: string) => string | undefined;

/** Columns every synced entity table shares plus the table-specific `extra`. */
function baseValues(m: MappedEntity, now: Date) {
  return {
    name: m.name,
    sourceKey: m.sourceKey,
    sourcePath: m.sourcePath,
    sourceProps: JSON.stringify(m.sourceProps),
    sourceHash: m.sourceHash,
    sourceText: m.sourceText,
    archived: m.archived,
    sourceSyncedAt: now,
    updatedAt: now,
    ...m.extra, // type/ddbCharacterId (characters), description (items/locations), noteType/status/date/arc (session notes)
  };
}

/**
 * True if any synced column differs from the current row. Compares the whole
 * set, never the hash alone: `source_hash` covers the note body only, so a
 * frontmatter-only edit (active, role, date, ...) leaves it unchanged.
 */
function differs(row: Record<string, unknown>, m: MappedEntity): boolean {
  if (row.name !== m.name) return true;
  if ((row.sourceKey ?? null) !== m.sourceKey) return true;
  if ((row.sourcePath ?? null) !== m.sourcePath) return true;
  if ((row.sourceProps ?? null) !== JSON.stringify(m.sourceProps)) return true;
  if (Boolean(row.archived) !== m.archived) return true;
  if ((row.sourceHash ?? null) !== m.sourceHash) return true;
  if ((row.sourceText ?? null) !== m.sourceText) return true;
  for (const [k, v] of Object.entries(m.extra)) {
    if ((row[k] ?? null) !== (v ?? null)) return true;
  }
  return false;
}

/**
 * Build the repo for one table. LIFETIME: one repo per sync run. It owns the
 * run's `claims` map (which note wrote each row), so create it inside the run
 * function and drop it afterwards; never keep one at module scope or reuse it
 * across ticks, or a note whose path sorts higher than before is mistaken for a
 * collision with its own earlier write and its edits are silently dropped.
 */
export function makeEntityRepo(db: Db, table: SyncTable, campaignId: string): EntityRepo {
  const t = table as unknown as typeof characters; // shared columns; safe for base ops
  const toRow = (r: typeof characters.$inferSelect): EntityRow =>
    ({ id: r.id, name: r.name, sourceKey: r.sourceKey, archived: Boolean(r.archived) });

  return {
    claims: new Map<string, string>(),
    findByKey(key: string): EntityRow | undefined {
      // Ordered so a (never expected) duplicate key resolves the same way every run.
      const r = db.select().from(t)
        .where(and(eq(t.campaignId, campaignId), eq(t.sourceKey, key)))
        .orderBy(t.id).get();
      return r ? toRow(r) : undefined;
    },
    findByNameUnlinked(name: string): EntityRow | undefined {
      const r = db.select().from(t)
        .where(and(eq(t.campaignId, campaignId), isNull(t.sourceKey), sql`lower(${t.name}) = lower(${name})`))
        .orderBy(t.id).get();
      return r ? toRow(r) : undefined;
    },
    insert(m: MappedEntity): string {
      const id = crypto.randomUUID();
      const now = new Date();
      // The union `t` type demands the intersection of every table's required columns
      // (e.g. `type` from `characters`), which doesn't hold for items/factions at
      // runtime. Localized cast on the values payload only; `t` itself stays typed.
      db.insert(t).values({ id, campaignId, createdAt: now, ...baseValues(m, now) } as typeof characters.$inferInsert).run();
      return id;
    },
    update(id: string, m: MappedEntity): boolean {
      const current = db.select().from(t).where(eq(t.id, id)).get()!;
      const changed = differs(current as Record<string, unknown>, m);
      const now = new Date();
      const values = baseValues(m, now);
      if (!changed) values.updatedAt = current.updatedAt as Date;
      db.update(t).set(values as Partial<typeof characters.$inferInsert>).where(eq(t.id, id)).run();
      return changed;
    },
  };
}

/** The hub id of the row a wikilink target points at, or undefined if it resolves to nothing. */
function idForTarget(
  db: Db, table: SyncTable, campaignId: string, target: string, resolve: ResolveTargetToKey,
): string | undefined {
  const key = resolve(target);
  if (key === undefined) return undefined;
  const t = table as unknown as typeof characters;
  return db.select({ id: t.id }).from(t)
    .where(and(eq(t.campaignId, campaignId), eq(t.sourceKey, key)))
    .orderBy(t.id).get()?.id;
}

/** Additive: add character↔faction links, resolving faction targets by source key; never removes. */
export function linkCharacterFactions(
  db: Db, campaignId: string, characterId: string, factionTargets: string[], resolve: ResolveTargetToKey,
): void {
  for (const target of factionTargets) {
    const factionId = idForTarget(db, factions, campaignId, target, resolve);
    if (!factionId) continue;
    db.insert(characterFactions).values({ characterId, factionId }).onConflictDoNothing().run();
  }
}

/** Additive: add character↔location links, resolving location targets by source key; never removes. */
export function linkCharacterLocations(
  db: Db, campaignId: string, characterId: string, locationTargets: string[], resolve: ResolveTargetToKey,
): void {
  for (const target of locationTargets) {
    const locationId = idForTarget(db, locations, campaignId, target, resolve);
    if (!locationId) continue;
    db.insert(characterLocations).values({ characterId, locationId }).onConflictDoNothing().run();
  }
}

/** Additive: add character↔item links for an item's holders, resolving character targets by source key. */
export function linkCharacterItems(
  db: Db, campaignId: string, itemId: string, heldByTargets: string[], resolve: ResolveTargetToKey,
): void {
  for (const target of heldByTargets) {
    const characterId = idForTarget(db, characters, campaignId, target, resolve);
    if (!characterId) continue;
    db.insert(characterItems).values({ characterId, itemId }).onConflictDoNothing().run();
  }
}

/**
 * Additive: link a session note to hub Locations. `locationTargets` resolve by
 * source key; `settingNames` match a location name case-insensitively (the
 * Notion-era behaviour). Which of the two to pass — e.g. settings only when a
 * note names no locations — is the caller's decision. Never removes links.
 * Returns the setting names that matched no location, for surfacing as sync
 * warnings.
 */
export function linkSessionNoteLocations(
  db: Db, campaignId: string, sessionNoteId: string,
  locationTargets: string[], settingNames: string[], resolve: ResolveTargetToKey,
): string[] {
  for (const target of locationTargets) {
    const locationId = idForTarget(db, locations, campaignId, target, resolve);
    if (!locationId) continue;
    db.insert(sessionNoteLocations).values({ sessionNoteId, locationId }).onConflictDoNothing().run();
  }

  const unmatched: string[] = [];
  for (const name of settingNames) {
    const loc = db.select().from(locations)
      .where(and(eq(locations.campaignId, campaignId), sql`lower(${locations.name}) = lower(${name})`))
      .orderBy(locations.id).get();
    if (!loc) { unmatched.push(name); continue; }
    db.insert(sessionNoteLocations).values({ sessionNoteId, locationId: loc.id }).onConflictDoNothing().run();
  }
  return unmatched;
}

/**
 * Set `parent_location_id` from a wikilink target resolved by source key.
 * Returns whether a parent was written; an absent, unresolvable, or self
 * target leaves the column as it was. No foreign key: the id may dangle.
 */
export function setLocationParent(
  db: Db, campaignId: string, locationId: string, parentTarget: string | undefined, resolve: ResolveTargetToKey,
): boolean {
  if (parentTarget === undefined) return false;
  const parentId = idForTarget(db, locations, campaignId, parentTarget, resolve);
  if (!parentId || parentId === locationId) return false;
  db.update(locations).set({ parentLocationId: parentId }).where(eq(locations.id, locationId)).run();
  return true;
}
