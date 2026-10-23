import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { buildBriefing, isStale } from "./briefing-build";
import { getBriefing, upsertBriefing, setManualFields } from "./briefings";
import type { BriefingResult } from "./briefing-agent";

const result: BriefingResult = {
  identity: "A broker of favours in Druvenlode.",
  wants: "Leverage over the Assembly.",
  partyKnows: "That he sold them a forged writ.",
  secret: "He informs for the Assembly.",
  voice: "Clipped, over-formal.",
  aliases: ["the mask guy"],
};

function seed(db: ReturnType<typeof createTestDb>["db"], campaignId: string, notionUrl: string | null = null) {
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, notion_url, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', ${notionUrl}, 0, 1, 1)`);
}

describe("buildBriefing", () => {
  it("writes the generated briefing", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const generate = vi.fn().mockResolvedValue(result);

    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate, fetchNotionBody: async () => null,
    });

    expect(b.identity).toBe("A broker of favours in Druvenlode.");
    expect(b.aliases).toEqual(["the mask guy"]);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("marks the briefing partial when the Notion body cannot be fetched", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, "https://notion.so/page");
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => { throw new Error("Notion unreachable"); },
    });
    expect(b.partial).toBe(true);
  });

  it("is not partial when the entity has no Notion page to fetch", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, null);
    const fetchNotionBody = vi.fn();
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody,
    });
    expect(b.partial).toBe(false);
    expect(fetchNotionBody).not.toHaveBeenCalled();
  });

  it("clears partial on a later successful build", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId, "https://notion.so/page");
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => { throw new Error("down"); },
    });
    const b = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result,
      fetchNotionBody: async () => "The page body.",
    });
    expect(b.partial).toBe(false);
  });

  it("preserves a hand-edited field across a rebuild", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    await setManualFields(db, campaignId, "character", "c1", { voice: "Never uses contractions." });

    const rebuilt = await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => ({ ...result, voice: "Something else entirely." }),
      fetchNotionBody: async () => null,
    });
    expect(rebuilt.voice).toBe("Never uses contractions.");
  });
});

describe("isStale", () => {
  it("is false right after a build", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(false);
  });

  it("is true once the entity's description changes", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await buildBriefing(db, {
      campaignId, targetKind: "character", targetId: "c1",
      generate: async () => result, fetchNotionBody: async () => null,
    });
    db.run(sql`UPDATE characters SET description = 'A broker of grudges.' WHERE id = 'c1'`);
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(true);
  });

  it("reports stale rather than throwing when the entity has been deleted", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, {
      campaignId, targetKind: "character", targetId: "gone", sourceHash: "h",
    });
    const b = await getBriefing(db, campaignId, "character", "gone");
    expect(await isStale(db, b!)).toBe(true);
  });
});
