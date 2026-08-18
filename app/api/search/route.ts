import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchIndex, rebuildSearchIndex, type SearchKind } from "@/lib/run/search-index";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

const VALID_KINDS: SearchKind[] = ["character", "location", "item", "faction", "thread", "clock"];

const HREF: Record<SearchKind, (id: string, campaignId: string) => string> = {
  character: (id) => `/characters/${id}`,
  location: (id) => `/locations/${id}`,
  item: (id) => `/items/${id}`,
  faction: (id) => `/factions/${id}`,
  thread: (_id, campaignId) => `/chronicle?campaignId=${campaignId}`,
  clock: (_id, campaignId) => `/chronicle?campaignId=${campaignId}`,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  // Required and enforced here: CommandPalette.tsx carries a comment about a
  // cross-campaign leak this shell shipped once before, and the old endpoint
  // tolerated a missing campaignId by returning everything.
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const q = searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ items: [] });

  const kindsParam = searchParams.get("kinds");
  const kinds = kindsParam
    ? kindsParam.split(",").filter((k): k is SearchKind => (VALID_KINDS as string[]).includes(k))
    : undefined;

  try {
    const hits = await searchIndex(sdb, { campaignId, q, kinds });
    return NextResponse.json({
      items: hits.map((h) => ({
        id: h.targetId,
        name: h.name,
        type: h.kind,
        href: HREF[h.kind](h.targetId, campaignId),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

/** Rebuild the campaign's index. Called once at rollout and from Settings. */
export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  try {
    const indexed = await rebuildSearchIndex(sdb, body.campaignId);
    return NextResponse.json({ indexed });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
