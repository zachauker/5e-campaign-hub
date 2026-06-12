import { NextResponse } from "next/server";
import { fetchPublicCharacter } from "@/lib/ddb/client";

// GET /api/ddb/characters/:id  — refresh a single character by DDB numeric ID
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const character = await fetchPublicCharacter(id);
    return NextResponse.json({ character });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch character" },
      { status: 400 }
    );
  }
}
