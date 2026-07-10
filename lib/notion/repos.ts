import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  characters, items, factions, characterFactions, characterItems,
} from "@/lib/db/schema";
import type { EntityRepo, EntityRow } from "./reconcile";
import type { MappedEntity } from "./map";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type SyncTable = typeof characters | typeof items | typeof factions;

/** Columns every synced entity table shares plus the table-specific `extra`. */
function baseValues(m: MappedEntity, now: Date) {
  return {
    name: m.name,
    notionUrl: m.notionUrl,
    notionPageId: m.notionPageId,
    notionProps: JSON.stringify(m.notionProps),
    archived: m.archived,
    notionSyncedAt: now,
    updatedAt: now,
    ...m.extra, // type/ddbCharacterId (characters) or description (items)
  };
}

/** True if any synced column differs from the current row. */
function differs(row: Record<string, unknown>, m: MappedEntity): boolean {
  if (row.name !== m.name) return true;
  if (row.notionUrl !== m.notionUrl) return true;
  if (Boolean(row.archived) !== m.archived) return true;
  if ((row.notionProps ?? null) !== JSON.stringify(m.notionProps)) return true;
  for (const [k, v] of Object.entries(m.extra)) {
    if ((row[k] ?? null) !== (v ?? null)) return true;
  }
  return false;
}

export function makeEntityRepo(db: Db, table: SyncTable, campaignId: string): EntityRepo {
  const t = table as unknown as typeof characters; // shared columns; safe for base ops

  return {
    findByPageId(pageId: string): EntityRow | undefined {
      const r = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.notionPageId, pageId))).get();
      return r ? { id: r.id, name: r.name, notionPageId: r.notionPageId, archived: Boolean(r.archived) } : undefined;
    },
    findByNameUnlinked(name: string): EntityRow | undefined {
      const r = db.select().from(t)
        .where(and(eq(t.campaignId, campaignId), isNull(t.notionPageId), sql`lower(${t.name}) = lower(${name})`))
        .get();
      return r ? { id: r.id, name: r.name, notionPageId: r.notionPageId, archived: Boolean(r.archived) } : undefined;
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
      const changed = !current.notionPageId || differs(current as Record<string, unknown>, m);
      const now = new Date();
      const values = baseValues(m, now);
      if (!changed) values.updatedAt = current.updatedAt as Date;
      db.update(t).set(values as Partial<typeof characters.$inferInsert>).where(eq(t.id, id)).run();
      return changed;
    },
  };
}

/** Additive: add character↔faction links matched by faction name; never removes. */
export function linkCharacterFactionsByName(
  db: Db, campaignId: string, characterId: string, factionNames: string[],
): void {
  for (const name of factionNames) {
    const fac = db.select().from(factions)
      .where(and(eq(factions.campaignId, campaignId), sql`lower(${factions.name}) = lower(${name})`))
      .get();
    if (!fac) continue;
    db.insert(characterFactions).values({ characterId, factionId: fac.id }).onConflictDoNothing().run();
  }
}

/** Additive: add character↔item links, resolving characters by notion page id. */
export function linkCharacterItemsByPageId(
  db: Db, itemId: string, characterPageIds: string[],
): void {
  for (const pid of characterPageIds) {
    const chr = db.select().from(characters).where(eq(characters.notionPageId, pid)).get();
    if (!chr) continue;
    db.insert(characterItems).values({ characterId: chr.id, itemId }).onConflictDoNothing().run();
  }
}
