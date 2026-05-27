import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { fetchPublicCharacter } from "@/lib/ddb/client";

interface SavedShareUrl {
  id: string;
  url: string;
  name?: string;
}

export async function GET() {
  const rows = await db.query.settings.findMany();
  const settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  // Share URLs are the reliable path — DDB's character-list API is blocked
  // for server-side requests (Cloudflare TLS fingerprinting).
  let shareUrls: SavedShareUrl[] = [];
  try {
    shareUrls = JSON.parse(settingsMap.ddb_share_urls ?? "[]");
  } catch {}

  if (shareUrls.length === 0) {
    return NextResponse.json({
      characters: [],
      error: settingsMap.ddb_cobalt_token
        ? "Your Cobalt token is valid, but D&D Beyond blocks automated character-list requests from servers. Add character share URLs in Settings instead."
        : "No characters configured. Add D&D Beyond character share URLs in Settings.",
    });
  }

  const characters = [];
  const errors: string[] = [];

  for (const entry of shareUrls) {
    try {
      const char = await fetchPublicCharacter(entry.url);
      characters.push(char);
    } catch (err) {
      errors.push(`${entry.name ?? entry.url}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json({
    characters,
    ...(errors.length > 0 && { warnings: errors }),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (body.shareUrl) {
    try {
      const character = await fetchPublicCharacter(body.shareUrl);
      return NextResponse.json({ character });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch character" },
        { status: 400 }
      );
    }
  }
  return NextResponse.json({ error: "Provide shareUrl" }, { status: 400 });
}
