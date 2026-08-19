import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/notion/test-helpers";
import { relatedEntities } from "./relations";

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('a', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
    VALUES ('b', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
  db.run(sql`INSERT INTO factions (id, campaign_id, name, archived, created_at, updated_at)
    VALUES ('f', ${campaignId}, 'Cerberus Assembly', 0, 1, 1)`);
  db.run(sql`INSERT INTO threads (id, campaign_id, title, status, archived, created_at, updated_at)
    VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'open', 0, 1, 1)`);
  for (const [id, kind, target] of [["l1", "character", "a"], ["l2", "character", "b"], ["l3", "faction", "f"]]) {
    db.run(sql`INSERT INTO thread_links (id, thread_id, target_kind, target_id, role)
      VALUES (${id}, 't1', ${kind}, ${target}, 'subject')`);
  }
}

describe("relatedEntities", () => {
  it("returns everything else linked to the same open thread", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId).sort()).toEqual(["b", "f"]);
    expect(related.find((r) => r.targetId === "f")).toMatchObject({
      kind: "faction", name: "Cerberus Assembly",
    });
  });

  it("never includes the entity itself", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId)).not.toContain("a");
  });

  it("ignores resolved and archived threads", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    db.run(sql`UPDATE threads SET status = 'resolved' WHERE id = 't1'`);
    expect(await relatedEntities(db, campaignId, "character", "a")).toEqual([]);
  });

  it("drops links whose target row no longer exists", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    db.run(sql`DELETE FROM characters WHERE id = 'b'`);
    const related = await relatedEntities(db, campaignId, "character", "a");
    expect(related.map((r) => r.targetId)).toEqual(["f"]);
  });

  it("returns an empty list for an entity with no links", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    expect(await relatedEntities(db, campaignId, "character", "unlinked")).toEqual([]);
  });
});
