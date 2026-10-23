import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { maps, locations, mapMarkers, campaigns } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";
import { syncEntityToIndex } from "@/lib/run/index-sync";

// Same directory the /api/world/[...path] asset route serves from — the seed file
// is baked into the image at world-data/build/locations-seed.json.
const WORLD_DIR = process.env.WORLD_DATA_DIR || path.join(process.cwd(), "world-data", "build");

type LocationType = "city" | "town" | "poi" | "region" | "other";

interface SeedRecord {
  name: string;
  lng: number;
  lat: number;
  type: LocationType;
  description: string;
  minZoom: number | null;
}

// POST /api/world/import-locations  { campaignId } -> seed the campaign's world
// map with the bundled Exandria locations. Idempotent: keyed on (campaign,
// lower(name)) for locations and on (worldMap, entityId) for markers.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const campaignId = body.campaignId;
  if (typeof campaignId !== "string" || !campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!campaign) return NextResponse.json({ error: "Unknown campaign" }, { status: 400 });

  let records: SeedRecord[];
  try {
    records = JSON.parse(fs.readFileSync(path.join(WORLD_DIR, "locations-seed.json"), "utf8"));
  } catch {
    return NextResponse.json({ error: "Location seed data not found on the server." }, { status: 500 });
  }

  const now = new Date();

  // Get-or-create the campaign's world map (mirrors /api/world).
  let world = await db.query.maps.findFirst({
    where: and(eq(maps.campaignId, campaignId), eq(maps.renderMode, "world")),
  });
  if (!world) {
    [world] = await db
      .insert(maps)
      .values({
        id: generateId(),
        campaignId,
        name: "Exandria",
        imagePath: "world",
        parentMapId: null,
        renderMode: "world",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }
  const worldMapId = world.id;

  // Existing state, to keep this idempotent without a per-row round trip.
  const existingLocs = await db.query.locations.findMany({ where: eq(locations.campaignId, campaignId) });
  const idByName = new Map(existingLocs.map((l) => [l.name.toLowerCase(), l.id]));
  const existingMarkers = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.mapId, worldMapId), eq(mapMarkers.type, "location")),
  });
  const markerEntityIds = new Set(existingMarkers.map((m) => m.entityId));

  let locationsCreated = 0;
  let locationsExisting = 0;
  let markersCreated = 0;
  let markersExisting = 0;

  for (const r of records) {
    let locId = idByName.get(r.name.toLowerCase());
    if (locId) {
      locationsExisting++;
    } else {
      locId = generateId();
      await db.insert(locations).values({
        id: locId,
        campaignId,
        name: r.name,
        description: r.description,
        type: r.type,
        createdAt: now,
        updatedAt: now,
      });
      idByName.set(r.name.toLowerCase(), locId);
      locationsCreated++;

      try {
        await syncEntityToIndex(db, campaignId, "location", locId);
      } catch (err) {
        // A failed index write must never fail the entity write that caused it —
        // the index is a derived convenience and Settings can rebuild it.
        console.warn("[search-index] sync failed:", (err as Error).message);
      }
    }

    if (markerEntityIds.has(locId)) {
      markersExisting++;
    } else {
      await db.insert(mapMarkers).values({
        id: generateId(),
        mapId: worldMapId,
        x: r.lng,
        y: r.lat,
        type: "location",
        entityId: locId,
        targetMapId: null,
        title: r.name,
        note: null,
        minZoom: r.minZoom,
        createdAt: now,
        updatedAt: now,
      });
      markerEntityIds.add(locId);
      markersCreated++;
    }
  }

  return NextResponse.json({ locationsCreated, locationsExisting, markersCreated, markersExisting });
}
