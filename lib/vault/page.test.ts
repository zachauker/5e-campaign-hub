import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { characters, characterLocations, factions, items, locations, sessionNotes } from "@/lib/db/schema";
import { AttachmentPathError } from "./attachments";
import { VaultPathError } from "./paths";
import { readVaultPage, resolveLinks, VaultNoteNotFoundError } from "./page";
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

function addFaction(db: TestDb, campaignId: string, name: string, archived = false) {
  const row = { id: id(), campaignId, name, archived, createdAt: now, updatedAt: now };
  db.insert(factions).values(row).run();
  return row.id;
}
function addItem(db: TestDb, campaignId: string, name: string) {
  const row = { id: id(), campaignId, name, createdAt: now, updatedAt: now };
  db.insert(items).values(row).run();
  return row.id;
}
function addNote(db: TestDb, campaignId: string, name: string, sourcePath: string | null = null) {
  const row = { id: id(), campaignId, name, sourcePath, createdAt: now, updatedAt: now };
  db.insert(sessionNotes).values(row).run();
  return row.id;
}
function addCharacter(db: TestDb, campaignId: string, name: string, archived = false) {
  const row = { id: id(), campaignId, name, type: "npc" as const, archived, createdAt: now, updatedAt: now };
  db.insert(characters).values(row).run();
  return row.id;
}

describe("wikilink resolution in readVaultPage", () => {
  const BODY = [
    "Met [[Barkeep]] at [[Tavern]], who holds [[Moonblade]] for [[Order of Dawn]].",
    "",
    "See [[Reunion]].",
    "",
  ].join("\n");

  it("resolves a link to each of the five mirrored kinds", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": BODY });
    const tavern = addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const barkeep = addCharacter(db, campaignId, "Barkeep");
    const blade = addItem(db, campaignId, "Moonblade");
    const order = addFaction(db, campaignId, "Order of Dawn");
    const reunion = addNote(db, campaignId, "Reunion");

    const { links } = readVaultPage(db, root, "Places/Tavern.md");
    expect(links).toEqual({
      Barkeep: { kind: "character", id: barkeep },
      Tavern: { kind: "location", id: tavern },
      Moonblade: { kind: "item", id: blade },
      "Order of Dawn": { kind: "faction", id: order },
      Reunion: { kind: "session", id: reunion },
    });
  });

  it("maps a target that opens nothing to null, keyed by the target as written", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": "See [[Nobody]] and [[A Thread|the thread]]." });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");

    const { links } = readVaultPage(db, root, "Places/Tavern.md");
    expect(links).toEqual({ Nobody: null, "A Thread": null });
  });

  it("keys a labelled link by its target, not its label", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": "Ask [[Barkeep|the keeper]]." });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const barkeep = addCharacter(db, campaignId, "Barkeep");

    expect(readVaultPage(db, root, "Places/Tavern.md").links).toEqual({ Barkeep: { kind: "character", id: barkeep } });
  });

  it("matches a case-mismatched target, including a non-ASCII capital", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": "[[barkeep]] and [[éowyn]]" });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const barkeep = addCharacter(db, campaignId, "Barkeep");
    const eowyn = addCharacter(db, campaignId, "Éowyn");

    expect(readVaultPage(db, root, "Places/Tavern.md").links).toEqual({
      barkeep: { kind: "character", id: barkeep },
      éowyn: { kind: "character", id: eowyn },
    });
  });

  it("resolves a target with an em dash, an ampersand and a curly apostrophe", () => {
    const { db, campaignId } = createTestDb();
    const a = "Cobalt Soul Reunion — Beilar & Elbera";
    const b = "The Bone Pit — Tubi\u2019s First Bout";
    const root = createTestVault({ "Places/Tavern.md": `[[${a}]] then [[${b}]]` });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const scene = addNote(db, campaignId, a);
    const bout = addNote(db, campaignId, b);

    expect(readVaultPage(db, root, "Places/Tavern.md").links).toEqual({
      [a]: { kind: "session", id: scene },
      [b]: { kind: "session", id: bout },
    });
  });

  it("finds links nested in a callout, a list item and a table cell", () => {
    const { db, campaignId } = createTestDb();
    const body = [
      "> [!lore] Deep", "> see [[Barkeep]]", "",
      "- item with [[Moonblade]]", "",
      "| who |", "|---|", "| [[Order of Dawn]] |", "",
    ].join("\n");
    const root = createTestVault({ "Places/Tavern.md": body });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    addCharacter(db, campaignId, "Barkeep");
    addItem(db, campaignId, "Moonblade");
    addFaction(db, campaignId, "Order of Dawn");

    const { links } = readVaultPage(db, root, "Places/Tavern.md");
    expect(Object.keys(links).sort()).toEqual(["Barkeep", "Moonblade", "Order of Dawn"]);
    expect(Object.values(links).every((l) => l !== null)).toBe(true);
  });

  it("is scoped to the note's campaign", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": "[[Foreigner]]" });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    const other = id();
    db.$client.prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
      .run(other, "Other", Math.floor(Date.now() / 1000));
    addCharacter(db, other, "Foreigner");

    expect(readVaultPage(db, root, "Places/Tavern.md").links).toEqual({ Foreigner: null });
  });

  it("returns no links for a note with none", () => {
    const { db, campaignId } = createTestDb();
    const root = createTestVault({ "Places/Tavern.md": "No links." });
    addLocation(db, campaignId, "Tavern", "Places/Tavern.md");
    expect(readVaultPage(db, root, "Places/Tavern.md").links).toEqual({});
  });
});

describe("resolveLinks", () => {
  it("breaks a cross-table collision by table order: character, location, item, faction, session", () => {
    const { db, campaignId } = createTestDb();
    const resolve = () => resolveLinks(db, campaignId, ["Dup"]).Dup;
    const note = addNote(db, campaignId, "Dup");
    expect(resolve()).toEqual({ kind: "session", id: note });
    const item = addItem(db, campaignId, "Dup");
    expect(resolve()).toEqual({ kind: "item", id: item });
    const faction = addFaction(db, campaignId, "Dup");
    // faction sits after item in table order, so item still wins
    expect(resolve()).toEqual({ kind: "item", id: item });
    expect(faction).toBeTruthy();
    const loc = addLocation(db, campaignId, "Dup", null);
    expect(resolve()).toEqual({ kind: "location", id: loc });
    const ch = addCharacter(db, campaignId, "Dup");
    expect(resolve()).toEqual({ kind: "character", id: ch });
  });

  it("prefers a live row to an archived one within a table, then the lowest id", () => {
    const { db, campaignId } = createTestDb();
    addCharacter(db, campaignId, "Twin", true);
    const live = addCharacter(db, campaignId, "Twin", false);
    expect(resolveLinks(db, campaignId, ["Twin"]).Twin).toEqual({ kind: "character", id: live });
  });

  it("still links an archived row when it is the only match", () => {
    const { db, campaignId } = createTestDb();
    const only = addFaction(db, campaignId, "Fallen Order", true);
    expect(resolveLinks(db, campaignId, ["Fallen Order"])["Fallen Order"]).toEqual({ kind: "faction", id: only });
  });

  it("treats __proto__ and constructor as ordinary targets", () => {
    const { db, campaignId } = createTestDb();
    const out = resolveLinks(db, campaignId, ["__proto__", "constructor"]);
    expect(Object.keys(out).sort()).toEqual(["__proto__", "constructor"]);
    expect(out.constructor).toBeNull();
  });

  it("queries nothing and returns {} for no targets", () => {
    const { db, campaignId } = createTestDb();
    expect(resolveLinks(db, campaignId, [])).toEqual({});
  });
});
