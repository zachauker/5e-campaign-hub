import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { itemIds: string[] };

  await db.transaction((tx) => {
    tx.delete(characterItems).where(eq(characterItems.characterId, characterId)).run();
    if (body.itemIds.length > 0) {
      tx.insert(characterItems)
        .values(body.itemIds.map((itemId) => ({ characterId, itemId })))
        .run();
    }
  });

  return NextResponse.json({ ok: true });
}
