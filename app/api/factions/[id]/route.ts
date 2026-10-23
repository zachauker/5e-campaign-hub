import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions, characterFactions, characters, mapMarkers, maps } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { syncEntityToIndex } from "@/lib/run/index-sync";
import { parseSourceProps } from "@/lib/vault/props";
import { omitLegacyColumns } from "@/lib/entities/legacy-columns";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.factions.findFirst({ where: eq(factions.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterFactions.findMany({
    where: eq(characterFactions.factionId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  const markerLinks = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "faction")),
  });
  const resolvedMapMarkers = await Promise.all(
    markerLinks.map(async (link) => {
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
    })
  );

  return NextResponse.json({
    ...omitLegacyColumns(row),
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    mapMarkers: resolvedMapMarkers,
    // The raw column is a JSON string; the page reads the decoded list.
    sourceProps: parseSourceProps(row.sourceProps),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.factions.findFirst({ where: eq(factions.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(factions)
    .set({
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(factions.id, id));

  try {
    await syncEntityToIndex(db, existing.campaignId, "faction", id);
  } catch (err) {
    // A failed index write must never fail the entity write that caused it —
    // the index is a derived convenience and Settings can rebuild it.
    console.warn("[search-index] sync failed:", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deleted] = await db.delete(factions).where(eq(factions.id, id)).returning();

  if (deleted) {
    try {
      await syncEntityToIndex(db, deleted.campaignId, "faction", id);
    } catch (err) {
      // A failed index write must never fail the entity write that caused it —
      // the index is a derived convenience and Settings can rebuild it.
      console.warn("[search-index] sync failed:", (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true });
}
