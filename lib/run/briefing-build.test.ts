import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";
import { createTestVault } from "@/lib/vault/test-helpers";
import { buildBriefing, isStale } from "./briefing-build";
import { buildPrompt, type BriefingResult } from "./briefing-agent";
import type { BriefingInputs } from "./briefing-inputs";
import { selectBuildTargets } from "./briefing-batch";
import { getBriefing, upsertBriefing, setManualFields } from "./briefings";

const result: BriefingResult = {
  identity: "A broker of favours in Druvenlode.",
  wants: "Leverage over the Assembly.",
  partyKnows: "That he sold them a forged writ.",
  secret: "He informs for the Assembly.",
  voice: "Clipped, over-formal.",
  aliases: ["the mask guy"],
};

const NOTE_PATH = "NPCs/Garrick.md";
const SECRET = "Garrick informs for the Assembly and reports every Thursday.";
const NOTE = [
  "---",
  "type: npc",
  "---",
  "Garrick keeps a mask on his belt at all times.",
  "",
  "> [!dm] Behind the screen",
  `> ${SECRET}`,
  "",
].join("\n");

const originalVaultPath = process.env.VAULT_PATH;
beforeEach(() => {
  process.env.VAULT_PATH = createTestVault({ [NOTE_PATH]: NOTE });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalVaultPath === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = originalVaultPath;
});

function seed(
  db: ReturnType<typeof createTestDb>["db"],
  campaignId: string,
  sourcePath: string | null = NOTE_PATH,
) {
  // source_text is what the sync stores: [!dm] already stripped. The file on
  // disk is the only place the secret survives.
  db.run(sql`INSERT INTO characters (id, campaign_id, name, type, description, source_path, source_hash, source_text, archived, created_at, updated_at)
    VALUES ('c1', ${campaignId}, 'Garrick Veldros', 'npc', 'A broker of favours.', ${sourcePath}, 'hash-1',
      'Garrick keeps a mask on his belt at all times.', 0, 1, 1)`);
}

const build = (db: ReturnType<typeof createTestDb>["db"], campaignId: string, generate = async () => result) =>
  buildBriefing(db, { campaignId, targetKind: "character", targetId: "c1", generate });

describe("buildBriefing", () => {
  it("writes the generated briefing", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    const generate = vi.fn().mockResolvedValue(result);

    const b = await build(db, campaignId, generate);

    expect(b.identity).toBe("A broker of favours in Druvenlode.");
    expect(b.aliases).toEqual(["the mask guy"]);
    expect(generate).toHaveBeenCalledOnce();
  });

  describe("what the agent receives", () => {
    it("is the RAW note body: the [!dm] secret reaches the agent's input", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      const generate = vi.fn().mockResolvedValue(result);

      await build(db, campaignId, generate);

      const inputs = generate.mock.calls[0][0] as BriefingInputs;
      expect(inputs.sourceBody).toContain("> [!dm] Behind the screen");
      expect(inputs.sourceBody).toContain(SECRET);
      // And through to the text the model is actually sent.
      expect(buildPrompt(inputs)).toContain(SECRET);
    });

    it("is not the stripped source_text column", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      const generate = vi.fn().mockResolvedValue(result);

      await build(db, campaignId, generate);

      const stored = db.all<{ t: string }>(sql`SELECT source_text AS t FROM characters WHERE id = 'c1'`)[0].t;
      expect(stored).not.toContain(SECRET);
      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).not.toBe(stored);
    });

    it("leaves frontmatter out, since it already arrives as sourceProps", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      const generate = vi.fn().mockResolvedValue(result);

      await build(db, campaignId, generate);

      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).not.toContain("type: npc");
    });

    it("reads the file at build time, so an edit made since the last sync is seen", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      fs.appendFileSync(path.join(process.env.VAULT_PATH!, NOTE_PATH), "\nHe has since fled to Rexxentrum.\n");
      const generate = vi.fn().mockResolvedValue(result);

      await build(db, campaignId, generate);

      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).toContain("fled to Rexxentrum");
    });
  });

  describe("partial", () => {
    it("is not partial when the note reads", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      expect((await build(db, campaignId)).partial).toBe(false);
    });

    it("is not partial for an entity with no vault note, and reads no file", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId, null);
      const generate = vi.fn().mockResolvedValue(result);

      const b = await build(db, campaignId, generate);

      expect(b.partial).toBe(false);
      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).toBeNull();
    });

    it("is partial, and still builds, when the note is unreadable", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId, "NPCs/Missing.md");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const generate = vi.fn().mockResolvedValue(result);

      const b = await build(db, campaignId, generate);

      expect(b.partial).toBe(true);
      expect(b.identity).toBe("A broker of favours in Druvenlode.");
      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("character c1"), expect.any(String));
    });

    it("is partial when the vault mount is gone", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId);
      process.env.VAULT_PATH = path.join(process.env.VAULT_PATH!, "no-such-mount");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await build(db, campaignId)).partial).toBe(true);
    });

    it("is partial when the stored path escapes the vault", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId, "../outside.md");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await build(db, campaignId)).partial).toBe(true);
    });

    it("is partial when the note has frontmatter but no readable text", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId, "NPCs/Empty.md");
      fs.writeFileSync(path.join(process.env.VAULT_PATH!, "NPCs/Empty.md"), "---\ntype: npc\n---\n\n");
      const generate = vi.fn().mockResolvedValue(result);

      const b = await build(db, campaignId, generate);

      expect(b.partial).toBe(true);
      expect((generate.mock.calls[0][0] as BriefingInputs).sourceBody).toBeNull();
    });

    it("clears on a later successful build", async () => {
      const { db, campaignId } = createTestDb();
      seed(db, campaignId, "NPCs/Late.md");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await build(db, campaignId)).partial).toBe(true);

      fs.writeFileSync(path.join(process.env.VAULT_PATH!, "NPCs/Late.md"), "Garrick arrives late.\n");
      expect((await build(db, campaignId)).partial).toBe(false);
    });
  });

  it("preserves a hand-edited field across a rebuild", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await build(db, campaignId);
    await setManualFields(db, campaignId, "character", "c1", { voice: "Never uses contractions." });

    const rebuilt = await build(db, campaignId, async () => ({ ...result, voice: "Something else entirely." }));
    expect(rebuilt.voice).toBe("Never uses contractions.");
  });
});

describe("isStale", () => {
  it("is false right after a build", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await build(db, campaignId);
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(false);
  });

  it("is true once the entity's description changes", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await build(db, campaignId);
    db.run(sql`UPDATE characters SET description = 'A broker of grudges.' WHERE id = 'c1'`);
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(true);
  });

  it("is true once the note is edited, which the sync records as a new source_hash", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await build(db, campaignId);
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(false);

    db.run(sql`UPDATE characters SET source_hash = 'hash-2' WHERE id = 'c1'`);
    expect(await isStale(db, b!)).toBe(true);
  });

  it("is answered from SQLite alone, with the vault unmounted", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    await build(db, campaignId);
    const b = await getBriefing(db, campaignId, "character", "c1");

    delete process.env.VAULT_PATH;

    expect(await isStale(db, b!)).toBe(false);
  });

  it("is true for a partial briefing even though its hash still matches", async () => {
    const { db, campaignId } = createTestDb();
    seed(db, campaignId);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const realRoot = process.env.VAULT_PATH!;
    process.env.VAULT_PATH = path.join(realRoot, "unmounted");
    const built = await build(db, campaignId);
    expect(built.partial).toBe(true);

    // The mount comes back. source_hash never moved, so the hash alone says "fresh".
    process.env.VAULT_PATH = realRoot;
    const b = await getBriefing(db, campaignId, "character", "c1");
    expect(await isStale(db, b!)).toBe(true);
    expect(await selectBuildTargets(db, campaignId, "all")).toEqual([
      { targetKind: "character", targetId: "c1" },
    ]);

    // Rebuilding with the note readable clears it, and it is then left alone.
    const rebuilt = await build(db, campaignId);
    expect(rebuilt.partial).toBe(false);
    expect(await isStale(db, rebuilt)).toBe(false);
    expect(await selectBuildTargets(db, campaignId, "all")).toEqual([]);
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
