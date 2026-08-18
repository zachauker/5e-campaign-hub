import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessionNotes, sessionReviews, settings } from "@/lib/db/schema";
import { fetchNotionPageBlocks } from "@/lib/notion/client";
import { blocksToPlainText, hashContent } from "@/lib/state/content-hash";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionNoteId = searchParams.get("sessionNoteId");
  if (!sessionNoteId) return NextResponse.json({ error: "sessionNoteId required" }, { status: 400 });

  const note = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, sessionNoteId) });
  if (!note?.notionPageId) return NextResponse.json({ reviewable: false, needsReview: false });

  const last = await db.query.sessionReviews.findFirst({
    where: eq(sessionReviews.sessionNoteId, sessionNoteId),
    orderBy: [desc(sessionReviews.reviewedAt)],
  });

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) {
    return NextResponse.json({ reviewable: true, needsReview: !last, lastReviewedAt: last?.reviewedAt ?? null });
  }

  let currentHash: string | null = null;
  try {
    currentHash = hashContent(blocksToPlainText(await fetchNotionPageBlocks(note.notionPageId, tokenRow.value)));
  } catch {
    // Notion unreachable — fall back to "needs review only if never reviewed".
    // Nothing here reaches the client, so no error-message mapping is needed.
  }

  return NextResponse.json({
    reviewable: true,
    // Never reviewed, or the page changed since the last review.
    needsReview: !last || (currentHash !== null && currentHash !== last.contentHash),
    lastReviewedAt: last?.reviewedAt ?? null,
    lastProposalCount: last?.proposalCount ?? 0,
    // Returned so the review slide-over can detect the page changing underneath
    // an open review before it applies anything.
    currentHash,
  });
}
