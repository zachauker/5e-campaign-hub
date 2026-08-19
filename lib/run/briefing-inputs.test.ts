import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { NotFoundError } from "@/lib/state/errors";
import { gatherInputs, hashInputs } from "./briefing-inputs";

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, notion_props, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', '{"Role":"Fixer"}', 0, 1, 1)`);
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
    expect(inputs.notionProps).toBe('{"Role":"Fixer"}');
    expect(inputs.threads).toEqual([
      { title: "Who forged the writ?", stakes: "The party stays hunted.", status: "open", role: "subject" },
    ]);
    expect(inputs.timeline).toEqual([
      { day: 100, kind: "thread_opened", title: "Writ questioned", body: "The party found the seal was wrong." },
    ]);
    expect(inputs.notionBody).toBeNull();
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

describe("hashInputs", () => {
  it("is stable across key order", async () => {
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

  it("ignores the Notion body so a fetch failure does not churn the hash", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const inputs = await gatherInputs(db, campaignId, "character", "c1");
    const withoutBody = hashInputs(inputs);
    const withBody = hashInputs({ ...inputs, notionBody: "A long page of prose." });
    expect(withBody).not.toBe(withoutBody);
  });
});
