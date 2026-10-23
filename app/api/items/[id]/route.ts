import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, characterItems, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { syncEntityToIndex } from "@/lib/run/index-sync";
import { parseSourceProps } from "@/lib/vault/props";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterItems.findMany({
    where: eq(characterItems.itemId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    notionProps: row.notionProps
      ? (JSON.parse(row.notionProps) as Array<{ label: string; value: string }>)
      : [],
    // The raw column is a JSON string; the page reads the decoded list.
    sourceProps: parseSourceProps(row.sourceProps),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(items)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(items.id, id));

  try {
    await syncEntityToIndex(db, existing.campaignId, "item", id);
  } catch (err) {
    // A failed index write must never fail the entity write that caused it —
    // the index is a derived convenience and Settings can rebuild it.
    console.warn("[search-index] sync failed:", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deleted] = await db.delete(items).where(eq(items.id, id)).returning();

  if (deleted) {
    try {
      await syncEntityToIndex(db, deleted.campaignId, "item", id);
    } catch (err) {
      // A failed index write must never fail the entity write that caused it —
      // the index is a derived convenience and Settings can rebuild it.
      console.warn("[search-index] sync failed:", (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true });
}
