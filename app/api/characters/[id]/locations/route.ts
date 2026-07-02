import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLocations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { locationIds: string[] };

  await db.delete(characterLocations).where(eq(characterLocations.characterId, characterId));
  if (body.locationIds.length > 0) {
    await db.insert(characterLocations).values(
      body.locationIds.map((locationId) => ({ characterId, locationId }))
    );
  }

  return NextResponse.json({ ok: true });
}
