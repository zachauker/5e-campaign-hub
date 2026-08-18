import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { getBriefing, upsertBriefing, setManualFields, BRIEFING_FIELDS } from "./briefings";
import { searchIndex } from "./search-index";

const base = { campaignId: "", targetKind: "character" as const, targetId: "c1" };

describe("upsertBriefing", () => {
  it("creates a briefing and returns it with parsed aliases", async () => {
    const { db, campaignId } = createTestDb();
    const b = await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker of favours.",
      wants: "Leverage over the Assembly.",
      partyKnows: "That he sold them a forged writ.",
      secret: "He is the Assembly's informant.",
      voice: "Clipped, over-formal, never uses contractions.",
      aliases: ["the mask guy"],
      sourceHash: "h1",
      partial: false,
    });

    expect(b.identity).toBe("A broker of favours.");
    expect(b.aliases).toEqual(["the mask guy"]);
    expect(b.manualFields).toEqual([]);
    expect(b.partial).toBe(false);
  });

  it("updates in place rather than creating a second row", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, identity: "First", sourceHash: "h1" });
    const second = await upsertBriefing(db, { ...base, campaignId, identity: "Second", sourceHash: "h2" });
    expect(second.identity).toBe("Second");
    expect(second.sourceHash).toBe("h2");

    const fetched = await getBriefing(db, campaignId, "character", "c1");
    expect(fetched?.identity).toBe("Second");
  });

  it("never clobbers a field the DM edited by hand", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, voice: "Model-written voice.", sourceHash: "h1" });
    await setManualFields(db, campaignId, "character", "c1", { voice: "Clipped. Never contractions." });

    const rebuilt = await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker.",
      voice: "A different model-written voice.",
      sourceHash: "h2",
    });

    expect(rebuilt.voice).toBe("Clipped. Never contractions.");
    expect(rebuilt.identity).toBe("A broker.");
    expect(rebuilt.manualFields).toEqual(["voice"]);
  });

  it("clears partial on a successful rebuild", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1", partial: true });
    const rebuilt = await upsertBriefing(db, { ...base, campaignId, sourceHash: "h2", partial: false });
    expect(rebuilt.partial).toBe(false);
  });

  it("writes the briefing into the search index without the secret", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, {
      ...base, campaignId,
      identity: "A broker of favours.",
      secret: "Informant.",
      aliases: ["the mask guy"],
      sourceHash: "h1",
    });
    expect((await searchIndex(db, { campaignId, q: "mask guy" })).map((h) => h.targetId)).toEqual(["c1"]);
    expect(await searchIndex(db, { campaignId, q: "informant" })).toEqual([]);
  });

  it("rejects an unknown targetKind", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      upsertBriefing(db, { ...base, campaignId, targetKind: "session" as never, sourceHash: "h" }),
    ).rejects.toThrow(/targetKind/);
  });
});

describe("setManualFields", () => {
  it("records each edited field once", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1" });
    await setManualFields(db, campaignId, "character", "c1", { voice: "A" });
    const b = await setManualFields(db, campaignId, "character", "c1", { voice: "B", wants: "C" });
    expect(b.voice).toBe("B");
    expect(b.wants).toBe("C");
    expect([...b.manualFields].sort()).toEqual(["voice", "wants"]);
  });

  it("throws when no briefing exists for the target", async () => {
    const { db, campaignId } = createTestDb();
    await expect(
      setManualFields(db, campaignId, "character", "nope", { voice: "A" }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a field name that is not a briefing field", async () => {
    const { db, campaignId } = createTestDb();
    await upsertBriefing(db, { ...base, campaignId, sourceHash: "h1" });
    await expect(
      setManualFields(db, campaignId, "character", "c1", { sourceHash: "x" } as never),
    ).rejects.toThrow(/field/);
  });
});

describe("BRIEFING_FIELDS", () => {
  it("lists exactly the model-writable fields", () => {
    expect([...BRIEFING_FIELDS].sort()).toEqual(
      ["aliases", "identity", "partyKnows", "secret", "voice", "wants"],
    );
  });
});
