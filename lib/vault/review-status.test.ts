import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { hashContent } from "@/lib/state/content-hash";
import { getReviewStatus } from "./review-status";
import { readNoteForReview } from "./note-text";
import { createTestVault } from "./test-helpers";

const original = process.env.VAULT_PATH;
let db: TestDb;
let campaignId: string;

beforeEach(() => {
  ({ db, campaignId } = createTestDb());
});
afterEach(() => {
  if (original === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = original;
});

function seedNote(id: string, sourcePath: string | null) {
  db.run(sql`INSERT INTO session_notes (id, campaign_id, name, source_path, archived, created_at, updated_at)
    VALUES (${id}, ${campaignId}, 'Session', ${sourcePath}, 0, 1, 1)`);
}
function seedReview(noteId: string, contentHash: string, proposalCount = 3) {
  db.run(sql`INSERT INTO session_reviews (id, session_note_id, reviewed_at, content_hash, proposal_count)
    VALUES (${"r-" + contentHash.slice(0, 6)}, ${noteId}, 1000, ${contentHash}, ${proposalCount})`);
}

describe("getReviewStatus", () => {
  it("offers review for a vault-backed note that has never been reviewed", async () => {
    process.env.VAULT_PATH = createTestVault({ "Sessions/S1.md": "They fought a wolf.\n" });
    seedNote("n1", "Sessions/S1.md");
    const status = await getReviewStatus(db, "n1");
    expect(status.reviewable).toBe(true);
    expect(status.needsReview).toBe(true);
    expect(status.currentHash).toBe(hashContent("They fought a wolf."));
  });

  it("is not reviewable when the note has no vault path", async () => {
    seedNote("n1", null);
    expect(await getReviewStatus(db, "n1")).toEqual({ reviewable: false, needsReview: false });
  });

  it("is not reviewable when the note does not exist", async () => {
    expect(await getReviewStatus(db, "ghost")).toEqual({ reviewable: false, needsReview: false });
  });

  it("is not reviewable when the note has no readable text, matching what the review route refuses", async () => {
    process.env.VAULT_PATH = createTestVault({ "Sessions/S1.md": "---\ntype: session\n---\n" });
    seedNote("n1", "Sessions/S1.md");
    expect((await getReviewStatus(db, "n1")).reviewable).toBe(false);
  });

  it("reports no review needed after a review of the same note, using the hash the review route stores", async () => {
    process.env.VAULT_PATH = createTestVault({ "Sessions/S1.md": "They fought a wolf.\n" });
    seedNote("n1", "Sessions/S1.md");
    // The review route stores readNoteForReview's hash; the status route must
    // read the same basis or needsReview is permanently wrong.
    seedReview("n1", (await readNoteForReview("Sessions/S1.md")).hash);
    const status = await getReviewStatus(db, "n1");
    expect(status.needsReview).toBe(false);
    expect(status.lastProposalCount).toBe(3);
    expect(status.lastReviewedAt).toBeInstanceOf(Date);
  });

  it("needs review again once the note's text changes", async () => {
    const root = createTestVault({ "Sessions/S1.md": "They fought a wolf.\n" });
    process.env.VAULT_PATH = root;
    seedNote("n1", "Sessions/S1.md");
    seedReview("n1", (await readNoteForReview("Sessions/S1.md")).hash);

    const fs = await import("fs");
    fs.writeFileSync(`${root}/Sessions/S1.md`, "They fought a wolf and a bear.\n");
    expect((await getReviewStatus(db, "n1")).needsReview).toBe(true);
  });

  it("does not ask for a re-review when only a [!dm] callout changed", async () => {
    const root = createTestVault({ "Sessions/S1.md": "They fought a wolf.\n\n> [!dm] Plan\n> A werewolf.\n" });
    process.env.VAULT_PATH = root;
    seedNote("n1", "Sessions/S1.md");
    seedReview("n1", (await readNoteForReview("Sessions/S1.md")).hash);

    const fs = await import("fs");
    fs.writeFileSync(`${root}/Sessions/S1.md`, "They fought a wolf.\n\n> [!dm] Plan\n> Just a wolf.\n");
    expect((await getReviewStatus(db, "n1")).needsReview).toBe(false);
  });

  it("falls back to 'needs review only if never reviewed' when the vault is unreachable", async () => {
    process.env.VAULT_PATH = createTestVault({});
    seedNote("n1", "Sessions/Missing.md");
    expect(await getReviewStatus(db, "n1")).toMatchObject({
      reviewable: true, needsReview: true, currentHash: null,
    });

    seedReview("n1", "abc123");
    expect(await getReviewStatus(db, "n1")).toMatchObject({
      reviewable: true, needsReview: false, currentHash: null,
    });
  });

  it("is not reviewable when the stored path escapes the vault", async () => {
    process.env.VAULT_PATH = createTestVault({});
    seedNote("n1", "../outside.md");
    expect((await getReviewStatus(db, "n1")).reviewable).toBe(false);
  });
});
