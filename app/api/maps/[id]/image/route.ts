import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMapImage, mapImageContentType } from "@/lib/maps/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await readMapImage(map.imagePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mapImageContentType(map.imagePath),
      "Cache-Control": "no-store",
    },
  });
}
