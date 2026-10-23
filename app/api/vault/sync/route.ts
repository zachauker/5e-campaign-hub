import { NextResponse } from "next/server";
import { runCampaignSync, statusForSyncError } from "@/lib/vault/run-sync";
import { tryAcquireSync, releaseSync } from "@/lib/vault/sync-lock";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string };
  const campaignId = body.campaignId;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  if (!tryAcquireSync(campaignId)) {
    return NextResponse.json({ error: "A sync is already running for this campaign" }, { status: 409 });
  }
  try {
    const summary = await runCampaignSync(campaignId);
    return NextResponse.json({ summary });
  } catch (err) {
    const status = statusForSyncError(err);
    if (status) return NextResponse.json({ error: (err as Error).message }, { status });
    throw err;
  } finally {
    releaseSync(campaignId);
  }
}
