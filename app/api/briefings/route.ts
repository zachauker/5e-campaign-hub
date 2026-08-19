import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getBriefing, setManualFields, BRIEFING_TARGET_KINDS, type BriefingTargetKind } from "@/lib/run/briefings";
import { buildBriefing, isStale } from "@/lib/run/briefing-build";
import { generateBriefing } from "@/lib/run/briefing-agent";
import { blocksToPlainText } from "@/lib/state/content-hash";
import { extractNotionPageId, fetchNotionPageBlocks } from "@/lib/notion/client";
import { toClientErrorMessage, NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

function readKind(raw: string | null): BriefingTargetKind | null {
  return raw && (BRIEFING_TARGET_KINDS as string[]).includes(raw) ? (raw as BriefingTargetKind) : null;
}

async function notionToken(): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  return row?.value?.trim() || null;
}

/** Fetch and flatten a Notion page body. Returns null when there is no token or no page id. */
async function fetchNotionBody(notionUrl: string): Promise<string | null> {
  const token = await notionToken();
  if (!token) return null;
  const pageId = extractNotionPageId(notionUrl);
  if (!pageId) return null;
  const blocks = await fetchNotionPageBlocks(pageId, token);
  return blocksToPlainText(blocks);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const targetKind = readKind(searchParams.get("targetKind"));
  const targetId = searchParams.get("targetId");
  if (!campaignId) return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: '"targetId" is required' }, { status: 400 });

  try {
    const briefing = await getBriefing(sdb, campaignId, targetKind, targetId);
    if (!briefing) return NextResponse.json({ briefing: null, stale: false });
    return NextResponse.json({ briefing, stale: await isStale(sdb, briefing) });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

/** Build (or rebuild) one briefing. Prep-time only — never called from /run's hot path. */
export async function POST(req: Request) {
  const body = await req.json();
  const targetKind = readKind(body.targetKind);
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (typeof body.targetId !== "string" || !body.targetId) {
    return NextResponse.json({ error: '"targetId" is required and must be a string' }, { status: 400 });
  }

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  const apiKey = keyRow?.value?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an Anthropic API key in Settings to build briefings." },
      { status: 400 },
    );
  }

  try {
    const briefing = await buildBriefing(sdb, {
      campaignId: body.campaignId,
      targetKind,
      targetId: body.targetId,
      generate: (inputs) => generateBriefing(inputs, { apiKey }),
      fetchNotionBody,
    });
    return NextResponse.json({ briefing, stale: false }, { status: 201 });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}

/** Apply DM edits. Edited fields survive every future rebuild. */
export async function PATCH(req: Request) {
  const body = await req.json();
  const targetKind = readKind(body.targetKind);
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  if (!targetKind) return NextResponse.json({ error: '"targetKind" must be a briefing target kind' }, { status: 400 });
  if (typeof body.targetId !== "string" || !body.targetId) {
    return NextResponse.json({ error: '"targetId" is required and must be a string' }, { status: 400 });
  }
  if (!body.edits || typeof body.edits !== "object") {
    return NextResponse.json({ error: '"edits" is required and must be an object' }, { status: 400 });
  }

  try {
    const briefing = await setManualFields(sdb, body.campaignId, targetKind, body.targetId, body.edits);
    return NextResponse.json({ briefing });
  } catch (err) {
    const status = err instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status });
  }
}
