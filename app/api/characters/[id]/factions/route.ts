import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterFactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { factionIds: string[] };

  await db.delete(characterFactions).where(eq(characterFactions.characterId, characterId));
  if (body.factionIds.length > 0) {
    await db.insert(characterFactions).values(
      body.factionIds.map((factionId) => ({ characterId, factionId }))
    );
  }

  return NextResponse.json({ ok: true });
}
