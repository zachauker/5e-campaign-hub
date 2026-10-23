import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { createTestVault } from "./test-helpers";
import { syncCampaign, type SyncSummary } from "./sync";
import { VaultUnreadableError } from "./config";
import { searchIndex } from "@/lib/run/search-index";
import {
  characters, factions, items, locations, sessionNotes,
  characterFactions, characterLocations, characterItems, sessionNoteLocations,
} from "@/lib/db/schema";

afterEach(() => vi.unstubAllEnvs());

/** A note file: frontmatter from `fm`, then `body`. */
function note(fm: Record<string, string>, body = "Prose.\n"): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${lines}\n---\n${body}`;
}

/**
 * A vault whose campaign folder has at least one usable note for every table,
 * so the per-table mass-wipe guard never fires and warnings stay meaningful.
 */
function fullVault(extra: Record<string, string> = {}): string {
  return createTestVault({
    "camp/Factions/Children of Malice.md": note({ type: "faction", faction_type: "Criminal" }),
    "camp/NPCs/Beilar.md": note({ type: "npc" }),
    "camp/Locations/Druvenlode.md": note({ type: "location" }),
    "camp/Items/Fragment.md": note({ type: "item" }),
    "camp/Sessions/Session 30.md": note({ type: "session" }),
    ...extra,
  });
}

/** Run a sync against a temp vault, with VAULT_PATH pointing at its root. */
function sync(db: TestDb, campaignId: string, vault: string, folder = "camp"): Promise<SyncSummary> {
  vi.stubEnv("VAULT_PATH", vault);
  return syncCampaign({ db, campaignId, folder: path.join(vault, folder) });
}

/** Warnings a table owns; campaign-scoped findings live in `summary.campaign`. */
const tableWarnings = (s: SyncSummary): string[] => Object.values(s.tables).flatMap((t) => t.warnings);
const allWarnings = (s: SyncSummary): string[] => [...tableWarnings(s), ...s.campaign.warnings];
const sum = (s: SyncSummary, key: "created" | "skipped" | "archived" | "updated"): number =>
  Object.values(s.tables).reduce((n, t) => n + t[key], 0);
const indexRows = (db: TestDb, campaignId: string) =>
  db.all<{ kind: string; target_id: string }>(sql`
    SELECT kind, target_id FROM search_index WHERE campaign_id = ${campaignId}
  `);

describe("syncCampaign", () => {
  it("creates rows for all nine mirrored types", async () => {
    const { db, campaignId } = createTestDb();
    const vault = createTestVault({
      "camp/NPCs/Beilar.md": note({ type: "npc" }),
      "camp/PCs/Shale.md": note({ type: "pc" }),
      "camp/Locations/Druvenlode.md": note({ type: "location" }),
      "camp/Items/Fragment.md": note({ type: "item" }),
      "camp/Factions/Children of Malice.md": note({ type: "faction" }),
      "camp/Sessions/Session 30.md": note({ type: "session" }),
      "camp/Arcs/The Cobalt Arc.md": note({ type: "arc" }),
      "camp/Side/Quarry Ambush.md": note({ type: "encounter", encounter_type: "combat" }),
      "camp/Side/Cobalt Soul Reunion.md": note({ type: "scene" }),
    });

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.created).toBe(2);
    expect(summary.tables.locations.created).toBe(1);
    expect(summary.tables.items.created).toBe(1);
    expect(summary.tables.factions.created).toBe(1);
    expect(summary.tables.sessionNotes.created).toBe(4);
    expect(allWarnings(summary)).toEqual([]);

    const chars = db.select().from(characters).where(eq(characters.campaignId, campaignId)).all();
    expect(chars.map((c) => c.type).sort()).toEqual(["npc", "pc"]);
    expect(chars.every((c) => c.sourcePath?.startsWith("camp/"))).toBe(true);

    const notes = db.select().from(sessionNotes).where(eq(sessionNotes.campaignId, campaignId)).all();
    expect(notes.map((n) => n.noteType).sort()).toEqual([
      "Character Event", "Combat Encounter", "Session Notes", "Story Outline",
    ]);
  });

  it("links relations after their targets exist", async () => {
    // factions -> characters -> locations -> items -> sessionNotes ordering: every
    // target is keyed on notion_id, so the links only land if the resolver maps
    // each wikilink basename through the scan to that note's source_key.
    const { db, campaignId } = createTestDb();
    const vault = createTestVault({
      "camp/Factions/Children of Malice.md": note({
        type: "faction", notion_id: "11111111-2222-3333-4444-555555555555",
      }),
      "camp/NPCs/Beilar.md": note({
        type: "npc", notion_id: "aaaaaaaabbbbccccddddeeeeeeeeeeee",
        factions: '"[[Children of Malice]]"', location: '"[[Druvenlode]]"',
      }),
      "camp/Locations/Wildemount.md": note({ type: "location", notion_id: "99999999999999999999999999999999" }),
      "camp/Locations/Druvenlode.md": note({
        type: "location", notion_id: "0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f",
        parent: '"[[Wildemount]]"',
      }),
      "camp/Items/Fragment.md": note({ type: "item", held_by: '"[[Beilar]]"' }),
      "camp/Sessions/Session 30.md": note({ type: "session", locations: '"[[Druvenlode]]"' }),
    });

    const summary = await sync(db, campaignId, vault);
    expect(allWarnings(summary)).toEqual([]);

    const beilar = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;
    const malice = db.select().from(factions).where(eq(factions.name, "Children of Malice")).get()!;
    const druvenlode = db.select().from(locations).where(eq(locations.name, "Druvenlode")).get()!;
    const wildemount = db.select().from(locations).where(eq(locations.name, "Wildemount")).get()!;
    const fragment = db.select().from(items).where(eq(items.name, "Fragment")).get()!;
    const note30 = db.select().from(sessionNotes).where(eq(sessionNotes.name, "Session 30")).get()!;

    // The rows are keyed on the dash-stripped notion id, never the basename.
    expect(malice.sourceKey).toBe("11111111222233334444555555555555");
    expect(druvenlode.sourceKey).toBe("0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f");

    expect(db.select().from(characterFactions)
      .where(eq(characterFactions.characterId, beilar.id)).all()
      .map((r) => r.factionId)).toEqual([malice.id]);
    expect(db.select().from(characterLocations)
      .where(eq(characterLocations.characterId, beilar.id)).all()
      .map((r) => r.locationId)).toEqual([druvenlode.id]);
    expect(db.select().from(characterItems)
      .where(eq(characterItems.itemId, fragment.id)).all()
      .map((r) => r.characterId)).toEqual([beilar.id]);
    expect(db.select().from(sessionNoteLocations)
      .where(eq(sessionNoteLocations.sessionNoteId, note30.id)).all()
      .map((r) => r.locationId)).toEqual([druvenlode.id]);
    expect(druvenlode.parentLocationId).toBe(wildemount.id);
  });

  it("resolves a wikilink that points at an alias, not a basename", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Factions/Cobalt Soul.md": note({
        type: "faction", notion_id: "cccccccccccccccccccccccccccccccc",
        aliases: "[The Soul]",
      }),
      "camp/NPCs/Beilar.md": note({ type: "npc", factions: '"[[The Soul]]"' }),
    });

    const summary = await sync(db, campaignId, vault);
    expect(allWarnings(summary)).toEqual([]);

    const beilar = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;
    const soul = db.select().from(factions).where(eq(factions.name, "Cobalt Soul")).get()!;
    expect(db.select().from(characterFactions)
      .where(eq(characterFactions.characterId, beilar.id)).all()
      .map((r) => r.factionId)).toEqual([soul.id]);
  });

  it("warns once per unresolvable wikilink target and never for a skipped type", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Threads/The Debt.md": note({ type: "thread" }),
      "camp/NPCs/Beilar.md": note({ type: "npc", factions: '["[[Ghost Faction]]", "[[The Debt]]"]' }),
      "camp/PCs/Shale.md": note({ type: "pc", factions: '"[[Ghost Faction]]"' }),
      // The same dead target cited from a second table: still one warning.
      "camp/Items/Fragment.md": note({ type: "item", held_by: '"[[Ghost Faction]]"' }),
    });

    const summary = await sync(db, campaignId, vault);

    // A target matching no note anywhere is a fact about the scan, so it is
    // reported once campaign-wide rather than once per citing table.
    const ghost = allWarnings(summary).filter((w) => w.includes("Ghost Faction"));
    expect(ghost).toHaveLength(1);
    expect(summary.campaign.warnings).toEqual(ghost);
    expect(tableWarnings(summary)).toEqual([]);
    // The Debt resolves to a real note that simply has no hub table: not a dead link.
    expect(allWarnings(summary).some((w) => w.includes("The Debt"))).toBe(false);
  });

  it("skips recognised non-mirrored types without warning", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Threads/The Debt.md": note({ type: "thread" }),
      "camp/Players/Shale's Journal.md": note({ type: "player-note" }),
      "camp/Reference/Deities.md": note({ type: "reference" }),
      "camp/Explorers of Exandria.md": note({ type: "campaign" }),
    });

    const summary = await sync(db, campaignId, vault);

    expect(allWarnings(summary)).toEqual([]);
    // Notes no table claimed are counted on the campaign bucket, not charged to
    // a table that had nothing to do with them.
    expect(summary.campaign.skipped).toBe(4);
    expect(sum(summary, "skipped")).toBe(0);
    expect(db.select().from(sessionNotes).where(eq(sessionNotes.campaignId, campaignId)).all())
      .toHaveLength(1);
  });

  it("warns once for a note with an unknown type", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Odd/Prophecy.md": note({ type: "prophecy" }),
      "camp/Odd/Untyped.md": "# No frontmatter at all\n",
    });

    const summary = await sync(db, campaignId, vault);

    // A note no table claimed is a campaign-level finding: charging it to a
    // table would send the DM looking in the wrong place.
    const warnings = summary.campaign.warnings;
    expect(warnings.filter((w) => w.includes("camp/Odd/Prophecy.md"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("camp/Odd/Untyped.md"))).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toMatch(/prophecy/);
    expect(tableWarnings(summary)).toEqual([]);
    expect(summary.campaign.skipped).toBe(2);
    expect(sum(summary, "skipped")).toBe(0);
    expect(sum(summary, "created")).toBe(5);
  });

  it("keeps campaign-scoped findings out of the per-table summaries", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Odd/Prophecy.md": note({ type: "prophecy" }),
      "camp/Threads/The Debt.md": note({ type: "thread" }),
    });

    const summary = await sync(db, campaignId, vault);

    // An unknown type warns; a recognised-skip type is silent. Both are counted
    // and reported campaign-wide, never charged to a table.
    expect(summary.campaign.warnings).toHaveLength(1);
    expect(summary.campaign.skipped).toBe(2); // prophecy + thread
    expect(tableWarnings(summary)).toEqual([]);
    expect(sum(summary, "skipped")).toBe(0);
    expect(sum(summary, "created")).toBe(5);
    expect(Object.keys(summary.tables).sort()).toEqual([
      "characters", "factions", "items", "locations", "sessionNotes",
    ]);
  });

  it("archives a row whose note disappeared", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/NPCs/Manner.md": note({ type: "npc" }) });
    await sync(db, campaignId, vault);
    const manner = db.select().from(characters).where(eq(characters.name, "Manner")).get()!;
    expect(indexRows(db, campaignId).map((r) => r.target_id)).toContain(manner.id);

    fs.rmSync(path.join(vault, "camp/NPCs/Manner.md"));
    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(1);
    const after = db.select().from(characters).where(eq(characters.id, manner.id)).get()!;
    expect(after).toBeDefined(); // archived, never deleted
    expect(Boolean(after.archived)).toBe(true);
    // An invisible entity must not keep answering run-mode searches.
    expect(indexRows(db, campaignId).map((r) => r.target_id)).not.toContain(manner.id);
    // The surviving NPC is untouched.
    expect(Boolean(db.select().from(characters).where(eq(characters.name, "Beilar")).get()!.archived)).toBe(false);
    // Archiving is named, not just counted — and a plain deletion is not a re-keying.
    expect(summary.tables.characters.warnings).toEqual(['Archived 1 entry no longer in the vault: "Manner".']);
  });

  it("names the rows it archived, capped with an 'and N more' tail", async () => {
    const { db, campaignId } = createTestDb();
    const names = Array.from({ length: 12 }, (_, i) => `Gone ${String(i).padStart(2, "0")}`);
    const vault = fullVault(Object.fromEntries(names.map((n) => [`camp/NPCs/${n}.md`, note({ type: "npc" })])));
    await sync(db, campaignId, vault);
    for (const n of names) fs.rmSync(path.join(vault, `camp/NPCs/${n}.md`));

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(12);
    const [warning] = summary.tables.characters.warnings;
    expect(warning).toContain("Archived 12 entries");
    expect(warning).toContain('"Gone 00"');
    expect(warning).toContain('"Gone 09"');
    expect(warning).not.toContain('"Gone 10"');
    expect(warning).toContain("and 2 more");
  });

  it("warns, naming both, when a basename-keyed note creates a row in the pass that archives another", async () => {
    // The Shale case: the hub row is keyed on the old notion id, the note lost it
    // (or never had it) and now falls to a basename that matches nothing.
    const { db, campaignId } = createTestDb();
    const oldId = "shale00000000000000000000000001";
    const vault = fullVault({ "camp/PCs/Shale Telenna.md": note({ type: "pc", notion_id: oldId }) });
    await sync(db, campaignId, vault);
    fs.rmSync(path.join(vault, "camp/PCs/Shale Telenna.md"));
    fs.writeFileSync(path.join(vault, "camp/PCs/Shale Telenna (Hill).md"), note({ type: "pc" }));

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.created).toBe(1);
    expect(summary.tables.characters.archived).toBe(1);
    const warning = summary.tables.characters.warnings.find((w) => w.includes("created from the file name"));
    expect(warning).toBeDefined();
    expect(warning).toContain('"Shale Telenna (Hill)"');
    expect(warning).toContain('"Shale Telenna"');
    expect(warning).toContain("notion_id");
  });

  it("does not raise the re-keying warning for a basename-keyed note that merely sits beside an archive", async () => {
    // Created in a different table from the archive, so nothing here lost an identity.
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/NPCs/Manner.md": note({ type: "npc" }) });
    await sync(db, campaignId, vault);
    fs.rmSync(path.join(vault, "camp/NPCs/Manner.md"));
    fs.writeFileSync(path.join(vault, "camp/Locations/Newtown.md"), note({ type: "location" }));

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.locations.created).toBe(1);
    expect(allWarnings(summary).some((w) => w.includes("created from the file name"))).toBe(false);
  });

  it("archives a row whose note changed to a type in another table", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/NPCs/Manner.md": note({ type: "npc", notion_id: "mannermannermannermannermanner11" }) });
    await sync(db, campaignId, vault);
    const asCharacter = db.select().from(characters).where(eq(characters.name, "Manner")).get()!;

    fs.writeFileSync(
      path.join(vault, "camp/NPCs/Manner.md"),
      note({ type: "location", notion_id: "mannermannermannermannermanner11" }),
      "utf8",
    );
    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(1);
    expect(summary.tables.locations.created).toBe(1);
    expect(Boolean(db.select().from(characters).where(eq(characters.id, asCharacter.id)).get()!.archived)).toBe(true);
    // No stale duplicate: exactly one characters row and one locations row for the note.
    expect(db.select().from(characters).where(eq(characters.name, "Manner")).all()).toHaveLength(1);
    const asLocation = db.select().from(locations).where(eq(locations.name, "Manner")).all();
    expect(asLocation).toHaveLength(1);
    expect(Boolean(asLocation[0].archived)).toBe(false);
    expect(asLocation[0].id).not.toBe(asCharacter.id);
  });

  it("does not archive anything when the folder has no markdown at all", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault();
    await sync(db, campaignId, vault);
    const before = db.select().from(characters).where(eq(characters.campaignId, campaignId)).all();
    expect(before).toHaveLength(1);

    // The mount drops out: the folder is still there but every note is gone.
    for (const dir of ["Factions", "NPCs", "Locations", "Items", "Sessions"]) {
      fs.rmSync(path.join(vault, "camp", dir), { recursive: true });
    }
    fs.mkdirSync(path.join(vault, "camp/_Attachments"), { recursive: true });
    fs.writeFileSync(path.join(vault, "camp/_Attachments/map.png"), "not a png", "utf8");

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(0);
    expect(summary.tables.characters.warnings.join(" ")).toMatch(/no/i);
    expect(sum(summary, "archived")).toBe(0);
    for (const row of [
      db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!,
      db.select().from(factions).where(eq(factions.campaignId, campaignId)).get()!,
      db.select().from(locations).where(eq(locations.campaignId, campaignId)).get()!,
      db.select().from(items).where(eq(items.campaignId, campaignId)).get()!,
      db.select().from(sessionNotes).where(eq(sessionNotes.campaignId, campaignId)).get()!,
    ]) {
      expect(Boolean(row.archived)).toBe(false);
    }
  });

  it("keeps a table's rows when that table alone saw no usable notes", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault();
    await sync(db, campaignId, vault);
    const malice = db.select().from(factions).where(eq(factions.name, "Children of Malice")).get()!;

    // Every faction note vanishes; the other four tables still have notes, so the
    // scan is trustworthy — but with nothing seen for factions we cannot read the
    // result as "every faction is gone".
    fs.rmSync(path.join(vault, "camp/Factions"), { recursive: true });
    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.factions.archived).toBe(0);
    expect(summary.tables.factions.warnings.join(" ")).toMatch(/mass wipe/i);
    expect(Boolean(db.select().from(factions).where(eq(factions.id, malice.id)).get()!.archived)).toBe(false);
    expect(summary.tables.characters.unchanged).toBe(1);
  });

  it("throws VaultUnreadableError before touching any row when the folder is missing", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault();
    await sync(db, campaignId, vault);
    const before = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;

    vi.stubEnv("VAULT_PATH", vault);
    await expect(
      syncCampaign({ db, campaignId, folder: path.join(vault, "gone") }),
    ).rejects.toThrow(VaultUnreadableError);

    const after = db.select().from(characters).where(eq(characters.id, before.id)).get()!;
    expect(Boolean(after.archived)).toBe(false);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.sourceSyncedAt).toEqual(before.sourceSyncedAt);
  });

  it("writes source_hash and source_text from the body", async () => {
    const { db, campaignId } = createTestDb();
    const body = "Prose line.\n\n> [!dm]\n> Hidden plan.\n\n> [!note]\n> Visible aside.\n";
    const vault = createTestVault({ "camp/NPCs/Beilar.md": note({ type: "npc" }, body) });

    await sync(db, campaignId, vault);

    const row = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;
    expect(row.sourceHash).toBe(crypto.createHash("sha256").update(body, "utf8").digest("hex"));
    expect(row.sourceText).toBe("Prose line.\nVisible aside.");
    expect(row.sourceText).not.toMatch(/Hidden plan/);
    expect(row.sourceSyncedAt).toBeInstanceOf(Date);
  });

  it("keeps syncing after one note fails to parse", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/NPCs/Broken.md": "---\ntype: [unclosed\n: :\n---\nbody\n" });

    const summary = await sync(db, campaignId, vault);

    expect(sum(summary, "created")).toBe(5);
    // The scan could not read the note at all, so no table owns the failure.
    const warnings = summary.campaign.warnings.filter((w) => w.includes("camp/NPCs/Broken.md"));
    expect(warnings).toHaveLength(1);
    expect(db.select().from(characters).where(eq(characters.name, "Beilar")).get()).toBeDefined();
    expect(db.select().from(characters).where(eq(characters.name, "Broken")).get()).toBeUndefined();
    // Every table says why it archived nothing: the scan was incomplete.
    for (const t of Object.values(summary.tables)) {
      expect(t.archived).toBe(0);
      expect(t.warnings.join(" ")).toMatch(/could not be read/i);
    }
  });

  it("does not archive a row whose note gained an unknown type", async () => {
    // `type: locatoin` is a typo, not a deletion. The note parsed, so its key is
    // recoverable even though its table is not — and the row must not vanish
    // from the hub (or the search index) while the DM fixes one character.
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/PCs/Shale.md": note({ type: "pc" }) });
    await sync(db, campaignId, vault);
    const beilar = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;

    fs.writeFileSync(path.join(vault, "camp/NPCs/Beilar.md"), note({ type: "nnpc" }), "utf8");
    const summary = await sync(db, campaignId, vault);

    // characters still saw Shale, so the mass-wipe guard does not fire and the
    // scan is complete: only the unrouted key protects Beilar's row.
    expect(summary.tables.characters.unchanged).toBe(1);
    expect(summary.tables.characters.archived).toBe(0);
    expect(sum(summary, "archived")).toBe(0);
    const after = db.select().from(characters).where(eq(characters.id, beilar.id)).get()!;
    expect(Boolean(after.archived)).toBe(false);
    expect(indexRows(db, campaignId).map((r) => r.target_id)).toContain(beilar.id);
    // The DM is still told, campaign-wide, that the note is unroutable.
    expect(summary.campaign.skipped).toBe(1);
    expect(summary.campaign.warnings).toHaveLength(1);
    expect(summary.campaign.warnings[0]).toContain("camp/NPCs/Beilar.md");
    expect(summary.campaign.warnings[0]).toContain("nnpc");
    expect(tableWarnings(summary)).toEqual([]);
  });

  it("archives a row whose note was retyped to a recognised non-mirrored type", async () => {
    // The mirror image: retyping a note to `thread` is deliberate, so the old
    // row should archive exactly as any cross-table retype does.
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/PCs/Shale.md": note({ type: "pc" }) });
    await sync(db, campaignId, vault);
    const beilar = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;

    fs.writeFileSync(path.join(vault, "camp/NPCs/Beilar.md"), note({ type: "thread" }), "utf8");
    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(1);
    expect(Boolean(db.select().from(characters).where(eq(characters.id, beilar.id)).get()!.archived)).toBe(true);
    expect(indexRows(db, campaignId).map((r) => r.target_id)).not.toContain(beilar.id);
    expect(summary.campaign.warnings).toEqual([]); // skipped types stay silent
  });

  it("does not archive anything when one note became unreadable", async () => {
    // The likeliest incompleteness on this deployment: the vault syncs between a
    // Mac and a server, so a half-saved file or an Obsidian conflict copy is an
    // everyday event. Beilar's note is unparseable, so Beilar is absent from the
    // scan — indistinguishable from deletion, and his row must survive.
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/PCs/Shale.md": note({ type: "pc" }) });
    await sync(db, campaignId, vault);
    const beilar = db.select().from(characters).where(eq(characters.name, "Beilar")).get()!;

    fs.writeFileSync(path.join(vault, "camp/NPCs/Beilar.md"), "---\ntype: [unclosed\n: :\n---\nbody\n", "utf8");
    const summary = await sync(db, campaignId, vault);

    // The table still saw Shale, so the per-table mass-wipe guard does NOT fire:
    // only the scan-incompleteness guard stands between Beilar and the archive.
    expect(summary.tables.characters.unchanged).toBe(1);
    expect(summary.tables.characters.archived).toBe(0);
    expect(summary.tables.characters.warnings.join(" ")).toMatch(/could not be read/i);
    const after = db.select().from(characters).where(eq(characters.id, beilar.id)).get()!;
    expect(Boolean(after.archived)).toBe(false);
    // Still searchable in run mode, too: nothing was de-indexed.
    expect(indexRows(db, campaignId).map((r) => r.target_id)).toContain(beilar.id);
    expect(sum(summary, "archived")).toBe(0);
  });

  // Skipped as root, which can read a 0o000 directory regardless of its mode.
  it.skipIf(process.getuid?.() === 0)(
    "does not archive anything when one subdirectory cannot be read", async () => {
      const { db, campaignId } = createTestDb();
      const vault = fullVault({
        "camp/NPCs/Manner.md": note({ type: "npc" }),
        "camp/PCs/Shale.md": note({ type: "pc" }),
      });
      await sync(db, campaignId, vault);
      const hidden = db.select().from(characters)
        .where(eq(characters.campaignId, campaignId)).all()
        .filter((c) => c.sourcePath?.startsWith("camp/NPCs/"));
      expect(hidden).toHaveLength(2);

      const locked = path.join(vault, "camp", "NPCs");
      fs.chmodSync(locked, 0o000);
      try {
        const summary = await sync(db, campaignId, vault);

        // characters still saw Shale, so only the scan-incompleteness guard
        // protects the two NPCs under the unreadable subtree.
        expect(summary.tables.characters.unchanged).toBe(1);
        expect(summary.tables.characters.archived).toBe(0);
        expect(sum(summary, "archived")).toBe(0);
        expect(summary.campaign.warnings.join(" ")).toContain("camp/NPCs");
        for (const row of hidden) {
          const after = db.select().from(characters).where(eq(characters.id, row.id)).get()!;
          expect(Boolean(after.archived)).toBe(false);
          expect(indexRows(db, campaignId).map((r) => r.target_id)).toContain(row.id);
        }
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    },
  );

  it("archives nothing when part of the campaign is a symlink the scan cannot follow", async () => {
    const { db, campaignId } = createTestDb();
    // A second character outside the link keeps the characters table seeing notes,
    // so the mass-wipe guard cannot stand in for the one under test.
    const vault = fullVault({ "camp/PCs/Percy.md": note({ type: "pc" }) });
    await sync(db, campaignId, vault);
    // The NPC folder is replaced by a link: its note vanishes from the scan, and
    // without the guard that reads as "deleted" and archives Beilar.
    const real = path.join(vault, "elsewhere");
    fs.mkdirSync(real);
    fs.renameSync(path.join(vault, "camp/NPCs"), path.join(real, "NPCs"));
    fs.symlinkSync(path.join(real, "NPCs"), path.join(vault, "camp/NPCs"));

    const summary = await sync(db, campaignId, vault);

    expect(sum(summary, "archived")).toBe(0);
    expect(Boolean(db.select().from(characters).where(eq(characters.name, "Beilar")).get()!.archived)).toBe(false);
    expect(summary.campaign.warnings.some((w) => w.includes("camp/NPCs") && w.includes("symlink"))).toBe(true);
    expect(summary.tables.characters.warnings.join(" ")).toContain("nothing was archived");
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault();
    await sync(db, campaignId, vault);
    const before = db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!;

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters).toMatchObject({ created: 0, adopted: 0, updated: 0, unchanged: 1, archived: 0 });
    expect(sum(summary, "created")).toBe(0);
    expect(sum(summary, "updated")).toBe(0);
    const after = db.select().from(characters).where(eq(characters.id, before.id)).get()!;
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("gives a legacy row to the note whose key matches it exactly, not to a promoting note", async () => {
    // R26: two notes share a basename and one of them carries a hub_id. The
    // exact-key note must keep the legacy row; a single pass sorted by path would
    // let the promoting note (sorted first) take it and rekey it instead.
    const { db, campaignId } = createTestDb();
    const vault = createTestVault({ "camp/Z/Manner.md": note({ type: "npc" }) });
    await sync(db, campaignId, vault);
    const legacy = db.select().from(characters).where(eq(characters.name, "Manner")).get()!;
    expect(legacy.sourceKey).toBe("Manner");

    fs.mkdirSync(path.join(vault, "camp/A"), { recursive: true });
    fs.writeFileSync(path.join(vault, "camp/A/Manner.md"), note({ type: "npc", hub_id: "hub-7" }), "utf8");
    const summary = await sync(db, campaignId, vault);

    const kept = db.select().from(characters).where(eq(characters.id, legacy.id)).get()!;
    expect(kept.sourceKey).toBe("Manner");
    expect(kept.sourcePath).toBe("camp/Z/Manner.md");
    expect(summary.tables.characters.created).toBe(1);
    expect(summary.tables.characters.adopted).toBe(0);
    const promoted = db.select().from(characters).where(eq(characters.sourceKey, "hub-7")).get()!;
    expect(promoted.id).not.toBe(legacy.id);
    expect(promoted.sourcePath).toBe("camp/A/Manner.md");
    expect(summary.tables.characters.archived).toBe(0);
  });

  it("updates a note that moved to a new path instead of colliding with itself", async () => {
    // R24: the claims map lives on a per-run repo, so the row this note wrote on
    // the previous pass is not mistaken for a competing note on this one.
    const { db, campaignId } = createTestDb();
    const vault = createTestVault({
      "camp/NPCs/Manner.md": note({ type: "npc", notion_id: "mannermannermannermannermanner11" }),
    });
    await sync(db, campaignId, vault);
    const before = db.select().from(characters).where(eq(characters.name, "Manner")).get()!;

    fs.mkdirSync(path.join(vault, "camp/Z"), { recursive: true });
    fs.renameSync(path.join(vault, "camp/NPCs/Manner.md"), path.join(vault, "camp/Z/Manner.md"));
    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters).toMatchObject({ created: 0, updated: 1, archived: 0 });
    const after = db.select().from(characters).where(eq(characters.id, before.id)).get()!;
    expect(after.sourcePath).toBe("camp/Z/Manner.md");
  });

  it("warns once per duplicated source key, naming the key", async () => {
    const { db, campaignId } = createTestDb();
    const dupe = "dupedupedupedupedupedupedupedupe";
    const vault = fullVault({
      "camp/A/One.md": note({ type: "npc", notion_id: dupe }),
      "camp/B/Two.md": note({ type: "npc", notion_id: dupe }),
      "camp/C/Three.md": note({ type: "npc", notion_id: dupe }),
    });

    const summary = await sync(db, campaignId, vault);

    const warnings = allWarnings(summary);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(dupe);
    // One row for the three notes, owned by the lowest path (plus Beilar).
    const rows = db.select().from(characters).where(eq(characters.sourceKey, dupe)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].sourcePath).toBe("camp/A/One.md");
    expect(db.select().from(characters).where(eq(characters.campaignId, campaignId)).all()).toHaveLength(2);
    expect(summary.tables.characters.archived).toBe(0);
  });

  it("indexes the four entity tables and never a session note", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault();

    await sync(db, campaignId, vault);

    const note30 = db.select().from(sessionNotes).where(eq(sessionNotes.name, "Session 30")).get()!;
    const rows = indexRows(db, campaignId);
    expect(rows.map((r) => r.kind).sort()).toEqual(["character", "faction", "item", "location"]);
    expect(rows.map((r) => r.target_id)).not.toContain(note30.id);
  });

  it("makes a phrase that lives only in a note body searchable, and keeps [!dm] out", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/NPCs/Mereth.md": note(
        { type: "npc" },
        "Keeps the lighthouse.\n\n> [!dm] Secret\n> Secretly a vampire.\n",
      ),
    });

    await sync(db, campaignId, vault);

    const find = async (q: string) =>
      (await searchIndex(db, { campaignId, q })).map((h) => h.targetId);
    const mereth = db.select().from(characters).where(eq(characters.name, "Mereth")).get()!;
    expect(await find("lighthouse")).toEqual([mereth.id]);
    expect(await find("vampire")).toEqual([]);
  });

  it("prefers a session note's location wikilinks over its settings strings", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Locations/Rexxentrum.md": note({ type: "location" }),
      "camp/Sessions/Session 31.md": note({
        type: "session", locations: '"[[Rexxentrum]]"', settings: "Druvenlode",
      }),
    });

    const summary = await sync(db, campaignId, vault);

    const note31 = db.select().from(sessionNotes).where(eq(sessionNotes.name, "Session 31")).get()!;
    const rex = db.select().from(locations).where(eq(locations.name, "Rexxentrum")).get()!;
    const links = db.select().from(sessionNoteLocations)
      .where(eq(sessionNoteLocations.sessionNoteId, note31.id)).all();
    expect(links.map((l) => l.locationId)).toEqual([rex.id]);
    expect(allWarnings(summary)).toEqual([]);
  });

  it("falls back to settings names when a session note has no location wikilinks", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({
      "camp/Sessions/Session 31.md": note({ type: "session", settings: "[Druvenlode, Nowhere]" }),
    });

    const summary = await sync(db, campaignId, vault);

    const note31 = db.select().from(sessionNotes).where(eq(sessionNotes.name, "Session 31")).get()!;
    const druvenlode = db.select().from(locations).where(eq(locations.name, "Druvenlode")).get()!;
    const links = db.select().from(sessionNoteLocations)
      .where(eq(sessionNoteLocations.sessionNoteId, note31.id)).all();
    expect(links.map((l) => l.locationId)).toEqual([druvenlode.id]);

    const unmatched = allWarnings(summary).filter((w) => w.includes("Nowhere"));
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toMatch(/setting/i);
  });

  it("adopts a world-seeded row by name without clobbering its type", async () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    db.insert(locations).values({
      id: "seed-druvenlode", campaignId, name: "Druvenlode",
      description: "City · Wildemount", type: "city", createdAt: now, updatedAt: now,
    } as never).run();
    const vault = fullVault({
      "camp/Locations/Druvenlode.md": note({ type: "location", location_type: "City", description: "A mining town." }),
    });

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.locations.adopted).toBe(1);
    const rows = db.select().from(locations).where(eq(locations.campaignId, campaignId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("seed-druvenlode");
    expect(rows[0].type).toBe("city");
    expect(rows[0].description).toBe("A mining town.");
    expect(rows[0].sourceKey).toBe("Druvenlode");
  });

  it("never archives a hand-made row that the vault does not own", async () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    db.insert(characters).values({
      id: "hand-made", campaignId, name: "Table NPC", type: "npc", createdAt: now, updatedAt: now,
    } as never).run();
    const vault = fullVault();

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.archived).toBe(0);
    expect(Boolean(db.select().from(characters).where(eq(characters.id, "hand-made")).get()!.archived)).toBe(false);
  });

  it("archives a character whose note sets active: false", async () => {
    const { db, campaignId } = createTestDb();
    const vault = fullVault({ "camp/NPCs/Manner.md": note({ type: "npc", active: "false" }) });

    const summary = await sync(db, campaignId, vault);

    expect(summary.tables.characters.created).toBe(2);
    expect(summary.tables.characters.archived).toBe(0); // the note is present; `active` did this
    const manner = db.select().from(characters).where(eq(characters.name, "Manner")).get()!;
    expect(Boolean(manner.archived)).toBe(true);
    expect(indexRows(db, campaignId).map((r) => r.target_id)).not.toContain(manner.id);
  });

  describe("D&D Beyond connection", () => {
    const pc = (sheet?: string) =>
      note({ type: "pc", notion_id: "pc1", ...(sheet ? { sheet } : {}) });
    const ddbIdOf = (db: TestDb) =>
      db.select().from(characters).where(eq(characters.name, "Percy")).get()!.ddbCharacterId;

    it("reads the id from a ddb.ac short link", async () => {
      const { db, campaignId } = createTestDb();
      await sync(db, campaignId, fullVault({ "camp/PCs/Percy.md": pc("https://ddb.ac/characters/9988/Slug") }));
      expect(ddbIdOf(db)).toBe("9988");
    });

    it("leaves a hub-entered ddb_character_id alone when the sheet url is unrecognised", async () => {
      const { db, campaignId } = createTestDb();
      const vault = fullVault({ "camp/PCs/Percy.md": pc("https://ddb.ac/characters/9988/Slug") });
      await sync(db, campaignId, vault);
      db.update(characters).set({ ddbCharacterId: "5555" }).where(eq(characters.name, "Percy")).run();

      fs.writeFileSync(path.join(vault, "camp/PCs/Percy.md"), pc("https://example.com/sheet.pdf"));
      await sync(db, campaignId, vault);
      expect(ddbIdOf(db)).toBe("5555");

      fs.writeFileSync(path.join(vault, "camp/PCs/Percy.md"), pc()); // sheet removed entirely
      await sync(db, campaignId, vault);
      expect(ddbIdOf(db)).toBe("5555");
    });
  });
});
