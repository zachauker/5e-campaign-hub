import { NextResponse } from "next/server";
import { getVaultSource, setVaultSource, InvalidRootPathError } from "@/lib/vault/run-sync";

export async function GET(req: Request) {
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  return NextResponse.json({ source: await getVaultSource(campaignId) });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string; rootPath?: unknown };
  const { campaignId, rootPath } = body;
  if (!campaignId || typeof rootPath !== "string") {
    return NextResponse.json({ error: "campaignId and rootPath are required" }, { status: 400 });
  }

  try {
    await setVaultSource(campaignId, rootPath);
  } catch (err) {
    if (err instanceof InvalidRootPathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
