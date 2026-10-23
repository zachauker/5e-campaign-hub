import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maskSettings } from "@/lib/settings-mask";

const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls", "anthropic_api_key", "vault_auto_sync_enabled", "vault_auto_sync_interval_minutes", "marker_appearance", "vault_name"];

export async function GET() {
  const rows = await db.query.settings.findMany();
  return NextResponse.json(maskSettings(rows));
}

export async function PUT(req: Request) {
  const body = await req.json() as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(key)) continue;
    await db
      .insert(settings)
      .values({ key, value: String(value) })
      .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } });
  }

  return NextResponse.json({ ok: true });
}
