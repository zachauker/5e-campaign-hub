import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { saveMapImage, saveTiledMapAssets } from "@/lib/maps/storage";
import { eq, and, isNull, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeNested = searchParams.get("includeNested") === "true";

  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const rows = await db.query.maps.findMany({
    where: includeNested
      ? eq(maps.campaignId, campaignId)
      : and(eq(maps.campaignId, campaignId), isNull(maps.parentMapId)),
    orderBy: [asc(maps.name)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const name = form.get("name");
  const campaignId = form.get("campaignId");
  const parentMapId = form.get("parentMapId");
  const renderModeField = form.get("renderMode");
  const file = form.get("image");

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: '"name" is required' }, { status: 400 });
  }
  if (typeof campaignId !== "string" || !campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: '"image" file is required' }, { status: 400 });
  }

  const isTiled = renderModeField === "tiled";
  const id = generateId();

  let imagePath: string;
  let width: number | null = null;
  let height: number | null = null;
  let maxZoom: number | null = null;

  if (isTiled) {
    const result = await saveTiledMapAssets(id, file);
    imagePath = result.imagePath;
    width = result.width;
    height = result.height;
    maxZoom = result.maxZoom;
  } else {
    imagePath = await saveMapImage(id, file);
  }

  const now = new Date();
  const [map] = await db
    .insert(maps)
    .values({
      id,
      campaignId,
      name: name.trim(),
      imagePath,
      parentMapId: typeof parentMapId === "string" && parentMapId ? parentMapId : null,
      renderMode: isTiled ? "tiled" : "static",
      width,
      height,
      maxZoom,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(map, { status: 201 });
}
