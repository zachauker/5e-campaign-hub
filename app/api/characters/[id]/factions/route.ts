import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterFactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { factionIds: string[] };

  await db.transaction((tx) => {
    tx.delete(characterFactions).where(eq(characterFactions.characterId, characterId)).run();
    if (body.factionIds.length > 0) {
      tx.insert(characterFactions)
        .values(body.factionIds.map((factionId) => ({ characterId, factionId })))
        .run();
    }
  });

  return NextResponse.json({ ok: true });
}
