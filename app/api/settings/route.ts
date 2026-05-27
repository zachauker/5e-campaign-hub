import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls"];

export async function GET() {
  const rows = await db.query.settings.findMany();
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key !== "ddb_cobalt_token") {
      result[row.key] = row.value;
    } else {
      result[row.key] = row.value ? "configured" : "";
    }
  }
  return NextResponse.json(result);
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
