import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMapTile } from "@/lib/maps/storage";
import { mercatorToSharpTile } from "@/lib/maps/mercator-adapter";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; z: string; x: string; y: string }> }
) {
  const { id, z, x, y } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map || map.renderMode !== "tiled" || !map.isWorldMap) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const yWithoutExt = y.replace(/\.\w+$/, "");
  const mz = Number(z);
  const mx = Number(x);
  const my = Number(yWithoutExt);
  if (!Number.isInteger(mz) || !Number.isInteger(mx) || !Number.isInteger(my)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sharpTile = mercatorToSharpTile(mz, mx, my);
  if (!sharpTile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readMapTile(id, String(sharpTile.z), String(sharpTile.x), String(sharpTile.y));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
