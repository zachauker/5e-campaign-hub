import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, locations, items, factions, encounters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");

  const [chars, locs, itms, facs, encs] = await Promise.all([
    campaignId
      ? db.query.characters.findMany({ where: eq(characters.campaignId, campaignId) })
      : db.query.characters.findMany(),
    campaignId
      ? db.query.locations.findMany({ where: eq(locations.campaignId, campaignId) })
      : db.query.locations.findMany(),
    campaignId
      ? db.query.items.findMany({ where: eq(items.campaignId, campaignId) })
      : db.query.items.findMany(),
    campaignId
      ? db.query.factions.findMany({ where: eq(factions.campaignId, campaignId) })
      : db.query.factions.findMany(),
    campaignId
      ? db.query.encounters.findMany({ where: eq(encounters.campaignId, campaignId) })
      : db.query.encounters.findMany(),
  ]);

  const results = [
    ...chars.map((c) => ({ id: c.id, name: c.name, type: "character", href: `/characters?open=${c.id}` })),
    ...locs.map((l) => ({ id: l.id, name: l.name, type: "location", href: `/locations?open=${l.id}` })),
    ...itms.map((i) => ({ id: i.id, name: i.name, type: "item", href: `/items?open=${i.id}` })),
    ...facs.map((f) => ({ id: f.id, name: f.name, type: "faction", href: `/factions?open=${f.id}` })),
    ...encs.map((e) => ({ id: e.id, name: e.name, type: "encounter", href: `/encounters/${e.id}` })),
  ];

  return NextResponse.json(results);
}
