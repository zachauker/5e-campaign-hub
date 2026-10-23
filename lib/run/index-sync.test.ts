import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { syncEntityToIndex, syncThreadToIndex, syncClockToIndex } from "./index-sync";
import { rebuildSearchIndex, searchIndex } from "./search-index";

describe("syncEntityToIndex", () => {
  it("indexes a newly written entity", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 'A duellist.', 0, 1, 1)`);

    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("follows a rename", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Merith Kane', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`UPDATE characters SET name = 'Mereth Kain' WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "merith" })).toEqual([]);
    expect((await searchIndex(db, { campaignId, q: "mereth" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("removes an archived entity from the index", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`UPDATE characters SET archived = 1 WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });

  it("removes a deleted entity from the index rather than throwing", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', 0, 1, 1)`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    db.run(sql`DELETE FROM characters WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect(await searchIndex(db, { campaignId, q: "mereth" })).toEqual([]);
  });

  it("keeps briefing aliases through an entity re-sync", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 0, 1, 1)`);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, aliases, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'c1', '["the mask guy"]', 'h', 1, 1, 1)`);

    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect((await searchIndex(db, { campaignId, q: "mask guy" })).map((h) => h.targetId)).toEqual(["c1"]);
  });
});

describe("syncThreadToIndex", () => {
  it("indexes a thread and drops it when archived", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO threads (id, campaign_id, title, stakes, status, archived, created_at, updated_at)
      VALUES ('t1', ${campaignId}, 'Who forged the writ?', 'The party stays hunted.', 'open', 0, 1, 1)`);
    await syncThreadToIndex(db, campaignId, "t1");
    expect((await searchIndex(db, { campaignId, q: "forged" })).map((h) => h.targetId)).toEqual(["t1"]);

    db.run(sql`UPDATE threads SET archived = 1 WHERE id = 't1'`);
    await syncThreadToIndex(db, campaignId, "t1");
    expect(await searchIndex(db, { campaignId, q: "forged" })).toEqual([]);
  });
});

describe("syncClockToIndex", () => {
  it("indexes a clock by name", async () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`INSERT INTO clocks (id, campaign_id, name, segments, filled, archived, created_at, updated_at)
      VALUES ('k1', ${campaignId}, 'Assembly closes in', 8, 2, 0, 1, 1)`);
    await syncClockToIndex(db, campaignId, "k1");
    expect((await searchIndex(db, { campaignId, q: "assembly" })).map((h) => h.targetId)).toEqual(["k1"]);
  });
});

describe("note body in the index", () => {
  const insert = (db: ReturnType<typeof createTestDb>["db"], campaignId: string, sourceText: string | null, description: string | null) =>
    db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, source_text, archived, created_at, updated_at)
      VALUES ('c1', ${campaignId}, 'Mereth Kain', 'npc', ${description}, ${sourceText}, 0, 1, 1)`);

  it("finds a phrase that appears only in the note body", async () => {
    const { db, campaignId } = createTestDb();
    insert(db, campaignId, "Owes a debt to the lighthouse keeper.", "A duellist.");

    await syncEntityToIndex(db, campaignId, "character", "c1");

    expect((await searchIndex(db, { campaignId, q: "lighthouse" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("indexes the description and the note body together, neither hiding the other", async () => {
    const { db, campaignId } = createTestDb();
    insert(db, campaignId, "Owes a debt to the lighthouse keeper.", "A celebrated duellist.");

    await syncEntityToIndex(db, campaignId, "character", "c1");
    expect((await searchIndex(db, { campaignId, q: "lighthouse" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect((await searchIndex(db, { campaignId, q: "celebrated" })).map((h) => h.targetId)).toEqual(["c1"]);

    await rebuildSearchIndex(db, campaignId);
    expect((await searchIndex(db, { campaignId, q: "lighthouse" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect((await searchIndex(db, { campaignId, q: "celebrated" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("falls back to the description when the note has no body text", async () => {
    const { db, campaignId } = createTestDb();
    insert(db, campaignId, "", "A duellist.");
    await syncEntityToIndex(db, campaignId, "character", "c1");
    expect((await searchIndex(db, { campaignId, q: "duellist" })).map((h) => h.targetId)).toEqual(["c1"]);

    db.run(sql`UPDATE characters SET source_text = '   ' WHERE id = 'c1'`);
    await syncEntityToIndex(db, campaignId, "character", "c1");
    expect((await searchIndex(db, { campaignId, q: "duellist" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("finds a body-only phrase after a full rebuild too", async () => {
    const { db, campaignId } = createTestDb();
    insert(db, campaignId, "Owes a debt to the lighthouse keeper.", null);

    await rebuildSearchIndex(db, campaignId);

    expect((await searchIndex(db, { campaignId, q: "lighthouse" })).map((h) => h.targetId)).toEqual(["c1"]);
  });

  it("lets a stored briefing win over the note body on rebuild", async () => {
    const { db, campaignId } = createTestDb();
    insert(db, campaignId, "Owes a debt to the lighthouse keeper.", null);
    db.run(sql`INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, aliases, identity, source_hash, built_at, created_at, updated_at)
      VALUES ('b1', ${campaignId}, 'character', 'c1', '[]', 'A smuggler of salt.', 'h', 1, 1, 1)`);

    await rebuildSearchIndex(db, campaignId);

    expect((await searchIndex(db, { campaignId, q: "smuggler" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect(await searchIndex(db, { campaignId, q: "lighthouse" })).toEqual([]);
  });
});

