import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { characters, characterLocations, locations, sessionNotes } from "@/lib/db/schema";
import { AttachmentPathError } from "./attachments";
import { VaultPathError } from "./paths";
import { readVaultPage, VaultNoteNotFoundError } from "./page";
import { createTestVault } from "./test-helpers";

const now = new Date();
const id = () => crypto.randomUUID();

function addLocation(db: TestDb, campaignId: string, name: string, sourcePath: string | null) {
  const row = { id: id(), campaignId, name, sourcePath, createdAt: now, updatedAt: now };
  db.insert(locations).values(row).run();
  return row.id;
}
function addNpcAt(db: TestDb, campaignId: string, name: string, locationId: string) {
  const row = { id: id(), campaignId, name, type: "npc" as const, createdAt: now, updatedAt: now };
  db.insert(characters).values(row).run();
  db.insert(characterLocations).values({ characterId: row.id, locationId }).run();
  return row.id;
}

const NOTE = [
  "---",
  "type: location",
  "---",
  "Intro line.",
  "",
  "![[Related.base#NPCs here]]",
  "",
  "![[Related.base#Threads]]",
  "",
  "> [!lore] Nested",
  "> ![[Related.base#NPCs here]]",
  "",
].join("\n");

describe("readVaultPage", () => {
  it("strips frontmatter and returns the parsed blocks", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": NOTE });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");

    const { blocks } = readVaultPage(db, root, "Places/Tavern.md");
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].inlines?.[0].text).toBe("Intro line.");
    expect(JSON.stringify(blocks)).not.toContain("type: location");
  });

  it("resolves an answerable embed against the note's own row, keyed by block id", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": NOTE });
    const tavern = addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const barkeep = addNpcAt(db, campaignId, "Barkeep", tavern);

    const { blocks, embeds } = readVaultPage(db, root, "Places/Tavern.md");
    const embed = blocks.find((b) => b.type === "embed")!;
    expect(embeds[embed.id]).toEqual({
      title: "NPCs here",
      items: [{ kind: "character", id: barkeep, name: "Barkeep" }],
    });
  });

  it("leaves an embed the hub cannot answer out of the map, and resolves one nested in a callout", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": NOTE });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");

    const { blocks, embeds } = readVaultPage(db, root, "Places/Tavern.md");
    const threads = blocks.find((b) => b.type === "embed" && b.embedHeading === "Threads")!;
    expect(threads.id in embeds).toBe(false);

    const callout = blocks.find((b) => b.type === "callout")!;
    const nested = callout.children!.find((b) => b.type === "embed")!;
    expect(nested.id).toContain(".");
    expect(embeds[nested.id].title).toBe("NPCs here");
    expect(Object.keys(embeds).sort()).toEqual([blocks.find((b) => b.type === "embed")!.id, nested.id].sort());
  });

  it("scopes the embed to the host's campaign", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": NOTE });
    const tavern = addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const otherCampaign = id();
    db.$client.prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
      .run(otherCampaign, "Other", Math.floor(Date.now() / 1000));
    const local = addNpcAt(db, campaignId, "Barkeep", tavern);
    addNpcAt(db, otherCampaign, "Foreigner", tavern);

    const { blocks, embeds } = readVaultPage(db, root, "Places/Tavern.md");
    const first = blocks.find((b) => b.type === "embed")!;
    expect(embeds[first.id].items.map((i) => i.id)).toEqual([local]);
  });

  it("serves a path with an ampersand, an em dash and a curly apostrophe", () => {
    const { db, campaignId } = createTestDb();
    const p = "Scenes/Cobalt Soul Reunion — Beilar & Elbera ’s.md";
    const root = createTestVault({ [p]: "Hello." });
    const noteId = id();
    db.insert(sessionNotes).values({ id: noteId, campaignId, name: "Reunion", sourcePath: p, createdAt: now, updatedAt: now }).run();

    expect(readVaultPage(db, root, p).blocks[0].inlines?.[0].text).toBe("Hello.");
  });

  it("refuses an absolute path and a .. path before touching the database", () => {
    const { db } = createTestDb();
    const root = createTestVault({});
    expect(() => readVaultPage(db, root, "/etc/passwd")).toThrow(VaultPathError);
    expect(() => readVaultPage(db, root, "../x.md")).toThrow(VaultPathError);
  });

  it("serves only a path some row was synced from", () => {
    const { db } = createTestDb();
    const root = createTestVault({ "_Templates/Secret.md": "private" });
    expect(() => readVaultPage(db, root, "_Templates/Secret.md")).toThrow(VaultNoteNotFoundError);
  });

  it("reports an indexed note whose file has gone as not found", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({});
    addLocation(db, campaignId, "Gone", "Places/Gone.md");
    expect(() => readVaultPage(db, root, "Places/Gone.md")).toThrow(VaultNoteNotFoundError);
  });

  it("refuses a file symlink that resolves outside the vault", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({});
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hub-outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "outside the vault");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "Link.md"));
    addLocation(db, campaignId, "Link", "Link.md");

    expect(() => readVaultPage(db, root, "Link.md")).toThrow(AttachmentPathError);
  });
});
