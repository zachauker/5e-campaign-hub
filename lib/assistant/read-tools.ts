import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, like } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { parseSourceProps } from "@/lib/vault/props";
import { omitLegacyColumns } from "@/lib/entities/legacy-columns";
import { characters, locations, items, factions, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";
import { monsterCache, maps, mapMarkers } from "@/lib/db/schema";

export type AppDb = BetterSQLite3Database<typeof schema>;
export type EntityKind = "character" | "location" | "item" | "faction";

const TABLES = { character: characters, location: locations, item: items, faction: factions } as const;

export interface EntityHit { kind: EntityKind; id: string; name: string; type: string | null }

export function searchEntities(db: AppDb, campaignId: string, input: { query: string }): EntityHit[] {
  const q = `%${input.query.trim().toLowerCase()}%`;
  const out: EntityHit[] = [];
  for (const kind of Object.keys(TABLES) as EntityKind[]) {
    const t = TABLES[kind];
    const rows = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.archived, false), like(t.name, q))).all();
    for (const r of rows) out.push({ kind, id: r.id, name: r.name, type: "type" in r ? (r.type as string) : null });
  }
  return out;
}

export function listEntities(db: AppDb, campaignId: string, input: { kind: EntityKind; type?: string }): EntityHit[] {
  const t = TABLES[input.kind];
  const rows = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.archived, false))).all();
  return rows
    .filter((r) => !input.type || ("type" in r && r.type === input.type))
    .map((r) => ({ kind: input.kind, id: r.id, name: r.name, type: "type" in r ? (r.type as string) : null }));
}

export function getEntity(db: AppDb, campaignId: string, input: { kind: EntityKind; id: string }) {
  const t = TABLES[input.kind];
  const row = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.id, input.id))).get();
  if (!row) return null;
  const { sourceProps, ...rest } = omitLegacyColumns(row) as Record<string, unknown>;
  return { ...rest, sourceProps: parseSourceProps(sourceProps as string | null) };
}

export function getRelationships(db: AppDb, campaignId: string, input: { kind: EntityKind; id: string }) {
  const t = TABLES[input.kind];
  const owner = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.id, input.id))).get();
  if (!owner) return { characters: [] };
  const linkedCharIds = (() => {
    if (input.kind === "faction") return db.select().from(characterFactions).where(eq(characterFactions.factionId, input.id)).all().map((r) => r.characterId);
    if (input.kind === "location") return db.select().from(characterLocations).where(eq(characterLocations.locationId, input.id)).all().map((r) => r.characterId);
    if (input.kind === "item") return db.select().from(characterItems).where(eq(characterItems.itemId, input.id)).all().map((r) => r.characterId);
    return [];
  })();
  const chars = linkedCharIds
    .map((cid) => db.select().from(characters).where(and(eq(characters.campaignId, campaignId), eq(characters.id, cid))).get())
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.archived)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  return { characters: chars };
}

export function listMonsters(db: AppDb, input: { query: string }) {
  const q = `%${input.query.trim().toLowerCase()}%`;
  return db.select().from(monsterCache).where(like(monsterCache.name, q)).all().map((r) => {
    let cr: string | null = null;
    try { cr = (JSON.parse(r.data) as { challenge_rating?: string }).challenge_rating ?? null; } catch { /* ignore */ }
    return { slug: r.slug, name: r.name, cr };
  });
}

export function getMapContext(db: AppDb, campaignId: string, input: { mapId: string }) {
  const map = db.select().from(maps).where(and(eq(maps.campaignId, campaignId), eq(maps.id, input.mapId))).get() ?? null;
  if (!map) return { map: null, markers: [] as { id: string; type: string; title: string | null; entityId: string | null }[] };
  const markers = db.select().from(mapMarkers).where(eq(mapMarkers.mapId, map.id)).all()
    .map((m) => ({ id: m.id, type: m.type, title: m.title, entityId: m.entityId }));
  return { map: { id: map.id, name: map.name, renderMode: map.renderMode }, markers };
}
