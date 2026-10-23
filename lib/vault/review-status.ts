import { desc, eq } from "drizzle-orm";
import { sessionNotes, sessionReviews } from "@/lib/db/schema";
import type { StateDb } from "@/lib/state/types";
import { readNoteForReview, reviewSourceFailure } from "./note-text";

export interface ReviewStatus {
  reviewable: boolean;
  needsReview: boolean;
  lastReviewedAt?: Date | null;
  lastProposalCount?: number;
  /** Hash of the note's current text. Null when the vault could not be read. */
  currentHash?: string | null;
}

/**
 * Whether a session note can be reviewed and whether it is due for one.
 *
 * `currentHash` comes from `readNoteForReview`, the same function the review
 * route stores its hash from, so a note reviewed once reports as not needing
 * review until its (stripped) text actually changes.
 *
 * "Reviewable" mirrors what the review route accepts: a vault path and some
 * readable text. A transient vault outage still reports reviewable (the DM
 * should be able to retry) and falls back to "needs review only if never
 * reviewed". A stored path that is invalid, or a note that cannot be parsed,
 * will never review successfully, so it is not offered.
 */
export async function getReviewStatus(db: StateDb, sessionNoteId: string): Promise<ReviewStatus> {
  const note = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, sessionNoteId) });
  if (!note?.sourcePath) return { reviewable: false, needsReview: false };

  const last = await db.query.sessionReviews.findFirst({
    where: eq(sessionReviews.sessionNoteId, sessionNoteId),
    orderBy: [desc(sessionReviews.reviewedAt)],
  });

  let currentHash: string | null = null;
  try {
    const { text, hash } = await readNoteForReview(note.sourcePath);
    if (!text.trim()) {
      // Not offered (the review route would refuse), but a note that was reviewed
      // before it was emptied keeps its history.
      return {
        reviewable: false,
        needsReview: false,
        lastReviewedAt: last?.reviewedAt ?? null,
        lastProposalCount: last?.proposalCount ?? 0,
        currentHash: hash,
      };
    }
    currentHash = hash;
  } catch (err) {
    const failure = reviewSourceFailure(err);
    if (!failure) throw err;
    // 503 is the transient case (vault unreachable); anything else is a note
    // that will not read no matter how often it is retried.
    if (failure.status !== 503) return { reviewable: false, needsReview: false };
  }

  return {
    reviewable: true,
    // Never reviewed, or the note changed since the last review.
    needsReview: !last || (currentHash !== null && currentHash !== last.contentHash),
    lastReviewedAt: last?.reviewedAt ?? null,
    lastProposalCount: last?.proposalCount ?? 0,
    // Returned so the review slide-over can detect the note changing underneath
    // an open review before it applies anything.
    currentHash,
  };
}
