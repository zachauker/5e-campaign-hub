import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { gatherInputs, hashInputs } from "./briefing-inputs";

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, source_props, source_path, source_hash, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', '{"Role":"Fixer"}', 'NPCs/Garrick.md', 'hash-1', 0, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, stakes, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'The party stays hunted.', 'open', 0, 1, 1)`);
  db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
    VALUES ('tl1', 't1', 'character', 'c1', 'subject')`);
  db.run(sql`INSERT INTO timeline_events (id, campaign_id, day, kind, title, body, source_kind, thread_id, created_at)
    VALUES ('e1', ${campaignId}, 100, 'thread_opened', 'Writ questioned', 'The party found the seal was wrong.', 'manual', 't1', 1)`);
}

describe("gatherInputs", () => {
  it("collects the entity, its linked threads, and recent timeline events", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);

    const inputs = await gatherInputs(db, campaignId, "character", "c1");

    expect(inputs.name).toBe("Garrick Veldros");
    expect(inputs.description).toBe("A broker of favours.");
    expect(inputs.sourceProps).toBe('{"Role":"Fixer"}');
    expect(inputs.sourcePath).toBe("NPCs/Garrick.md");
    expect(inputs.sourceHash).toBe("hash-1");
    expect(inputs.threads).toEqual([
      { title: "Who forged the writ?", stakes: "The party stays hunted.", status: "open", role: "subject" },
    ]);
    expect(inputs.timeline).toEqual([
      { day: 100, kind: "thread_opened", title: "Writ questioned", body: "The party found the seal was wrong." },
    ]);
    // The body is read from the vault by the builder, never by this SQLite-only step.
    expect(inputs.sourceBody).toBeNull();
  });

  it("throws when the target does not exist", async () => {
    const { db, campaignId } = createTestDb();
    await expect(gatherInputs(db, campaignId, "character", "nope")).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown targetKind rather than interpolating it into SQL", async () => {
    const { db, campaignId } = createTestDb();
    await expect(gatherInputs(db, campaignId, "sessions; DROP TABLE characters", "c1")).rejects.toThrow(/targetKind/);
  });
});

  it("keeps thread-linked events when incidental name matches would crowd them out", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO factions (id, campaign_id, name, archived, created_at, updated_at)
      VALUES ('f1', ${campaignId}, 'The Watch', 0, 1, 1)`);
    db.run(sql`INSERT INTO threads (id, campaign_id, title, status, archived, created_at, updated_at)
      VALUES ('t1', ${campaignId}, 'Who bribed the gate captain?', 'open', 0, 1, 1)`);
    db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
      VALUES ('tl1', 't1', 'faction', 'f1', 'subject')`);
    // The one event that is genuinely about this faction, and the oldest.
    db.run(sql`INSERT INTO timeline_events (id, campaign_id, day, kind, title, body, source_kind, thread_id, created_at)
      VALUES ('relevant', ${campaignId}, 1, 'thread_opened', 'The captain took coin', NULL, 'manual', 't1', 1)`);
    // Chatter that merely says the name, all of it more recent.
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO timeline_events (id, campaign_id, day, kind, title, body, source_kind, created_at)
        VALUES (${"noise" + i}, ${campaignId}, ${100 + i}, 'note', 'A quiet week', 'The Watch patrolled as usual.', 'manual', 1)`);
    }

    const inputs = await gatherInputs(db, campaignId, "faction", "f1");
    expect(inputs.timeline.map((e) => e.title)).toContain("The captain took coin");
  });

describe("hashInputs", () => {
  it("is stable across repeated calls", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const a = await gatherInputs(db, campaignId, "character", "c1");
    const b = await gatherInputs(db, campaignId, "character", "c1");
    expect(hashInputs(a)).toBe(hashInputs(b));
  });

  it("changes when the description changes", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const before = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    db.run(sql`UPDATE characters SET description = 'A broker of grudges.' WHERE id = 'c1'`);
    const after = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    expect(after).not.toBe(before);
  });

  it("changes when only the note's source_hash changes, so an edited note marks its briefing stale", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const before = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    db.run(sql`UPDATE characters SET source_hash = 'hash-2' WHERE id = 'c1'`);
    const after = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    expect(after).not.toBe(before);
  });

  it("changes when the note's properties change", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const before = hashInputs(await gatherInputs(db, campaignId, "character", "c1"));
    db.run(sql`UPDATE characters SET source_props = '{"Role":"Spy"}' WHERE id = 'c1'`);
    expect(hashInputs(await gatherInputs(db, campaignId, "character", "c1"))).not.toBe(before);
  });

  it("does not depend on the body text, so staleness never needs the vault mounted", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const inputs = await gatherInputs(db, campaignId, "character", "c1");
    expect(hashInputs({ ...inputs, sourceBody: "A long page of prose." })).toBe(hashInputs(inputs));
  });
});
