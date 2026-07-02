import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractNotionPageId, fetchNotionPageBlocks } from "@/lib/notion/client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Provide a Notion page url" }, { status: 400 });
  }

  const pageId = extractNotionPageId(url);
  if (!pageId) {
    return NextResponse.json({ error: "Could not find a page ID in that URL" }, { status: 400 });
  }

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) {
    return NextResponse.json(
      { error: "Add a Notion integration token in Settings to see notes here" },
      { status: 400 }
    );
  }

  try {
    const blocks = await fetchNotionPageBlocks(pageId, tokenRow.value);
    return NextResponse.json({ blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Notion page";
    const notShared = /could not find|restricted|unauthorized/i.test(message);
    return NextResponse.json(
      {
        error: notShared
          ? "This page hasn't been shared with the integration, or doesn't exist"
          : message,
      },
      { status: 400 }
    );
  }
}
