import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { selectBuildTargets } from "./briefing-batch";

function seedEntities(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('linked', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('loose', ${campaignId}, 'A Passing Guard', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('gone', ${campaignId}, 'Retired NPC', 'npc', 1, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'open', 0, 1, 1)`);
  db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
    VALUES ('tl1', 't1', 'character', 'linked', 'subject')`);
}

describe("selectBuildTargets", () => {
  it("scope 'session' picks only entities linked to open threads", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    const targets = await selectBuildTargets(db, campaignId, "session");
    expect(targets).toEqual([{ targetKind: "character", targetId: "linked" }]);
  });

  it("scope 'session' ignores entities linked only to resolved threads", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    db.run(sql`UPDATE threads SET status = 'resolved' WHERE id = 't1'`);
    expect(await selectBuildTargets(db, campaignId, "session")).toEqual([]);
  });

  it("scope 'all' picks every unarchived entity", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId).sort();
    expect(ids).toEqual(["linked", "loose"]);
  });

  it("skips entities that already have a fresh briefing", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    // A briefing whose hash matches nothing is stale, so seed one that matches.
    const { gatherInputs, hashInputs } = await import("./briefing-inputs");
    const inputs = await gatherInputs(db, campaignId, "character", "loose");
    const hash = hashInputs({ ...inputs, notionBody: null });
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'loose', ${hash}, 1, 1, 1)`);

    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId);
    expect(ids).toEqual(["linked"]);
  });

  it("includes an entity whose briefing has gone stale", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'loose', 'a-hash-that-no-longer-matches', 1, 1, 1)`);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId).sort();
    expect(ids).toEqual(["linked", "loose"]);
  });

  it("scopes to the campaign", async () => {
    const { db, campaignId } = createTestDb();
    seedEntities(db, campaignId);
    // characters.campaign_id has a foreign key to campaigns.id, so the
    // "other campaign" row must exist before it can be referenced.
    db.run(sql`INSERT INTO campaigns (id, name, created_at) VALUES ('other-campaign', 'Other Campaign', 1)`);
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('theirs', 'other-campaign', 'Someone Else', 'npc', 0, 1, 1)`);
    const ids = (await selectBuildTargets(db, campaignId, "all")).map((t) => t.targetId);
    expect(ids).not.toContain("theirs");
  });
});
