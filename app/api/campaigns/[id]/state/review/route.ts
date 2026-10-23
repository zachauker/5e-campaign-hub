import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings, sessionNotes, sessionReviews } from "@/lib/db/schema";
import { readNoteForReview, reviewSourceFailure } from "@/lib/vault/note-text";
import { getCampaignDay } from "@/lib/state/advance";
import { runSessionReview, type ReviewEvent } from "@/lib/state/review-agent";
import { toClientErrorMessage } from "@/lib/state/errors";
import { generateId } from "@/lib/utils";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

const fail = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  const body = (await req.json().catch(() => ({}))) as { sessionNoteId?: string };
  if (!body.sessionNoteId) return fail("sessionNoteId required", 400);

  const note = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, body.sessionNoteId) });
  if (!note) return fail("Session note not found", 404);
  if (!note.sourcePath) return fail("This session note has no linked vault note to review", 400);

  const apiKeyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  if (!apiKeyRow?.value) return fail("Add an Anthropic API key in Settings first", 400);

  // Read the note up front: if the vault is unreachable, the pass emits no proposals at all
  // rather than half a review. sourceText below is the verbatim, server-read note text with
  // every [!dm] callout already stripped (readNoteText) — nothing derived from the model ever
  // reaches this variable or the tools built from it.
  // contentHash comes from the same call, so the status route compares like with like.
  let sourceText: string;
  let contentHash: string;
  try {
    ({ text: sourceText, hash: contentHash } = await readNoteForReview(note.sourcePath));
  } catch (err) {
    const failure = reviewSourceFailure(err);
    if (!failure) throw err;
    return fail(failure.message, failure.status);
  }
  if (!sourceText.trim()) return fail("The linked vault note has no readable text", 400);

  const currentDay = await getCampaignDay(sdb, campaignId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ReviewEvent & { contentHash?: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        let proposalCount = 0;
        await runSessionReview(
          {
            apiKey: apiKeyRow.value,
            db: sdb,
            campaignId,
            sessionNoteId: body.sessionNoteId!,
            sourceText,
            currentDay,
          },
          (e) => {
            if (e.type === "summary") {
              proposalCount = e.proposalCount ?? 0;
              send({ ...e, contentHash });
            } else {
              send(e);
            }
          },
        );

        await db.insert(sessionReviews).values({
          id: generateId(),
          sessionNoteId: body.sessionNoteId!,
          reviewedAt: new Date(),
          contentHash,
          proposalCount,
        });
      } catch (err) {
        send({ type: "error", message: toClientErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
  });
}
