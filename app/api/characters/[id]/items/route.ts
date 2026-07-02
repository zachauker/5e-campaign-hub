import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { itemIds: string[] };

  await db.delete(characterItems).where(eq(characterItems.characterId, characterId));
  if (body.itemIds.length > 0) {
    await db.insert(characterItems).values(
      body.itemIds.map((itemId) => ({ characterId, itemId }))
    );
  }

  return NextResponse.json({ ok: true });
}
