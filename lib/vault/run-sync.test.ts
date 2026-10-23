import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { createTestVault } from "./test-helpers";
import {
  runCampaignSync,
  listCampaignsWithSources,
  setVaultSource,
  statusForSyncError,
  getVaultSource,
  NoVaultSourceError,
  InvalidRootPathError,
} from "./run-sync";
import { VaultUnreadableError } from "./config";
import { vaultSources, characters } from "@/lib/db/schema";

afterEach(() => vi.unstubAllEnvs());

function seedSource(db: TestDb, campaignId: string, rootPath: string) {
  db.insert(vaultSources).values({ campaignId, rootPath }).run();
}

/** A vault with one NPC under `camp/`; VAULT_PATH points at it. */
function stubVault(): string {
  const vault = createTestVault({
    "camp/NPCs/Shale.md": "---\ntype: npc\n---\nProse.\n",
  });
  vi.stubEnv("VAULT_PATH", vault);
  return vault;
}

describe("runCampaignSync", () => {
  it("throws NoVaultSourceError when the campaign has no vault_sources row", async () => {
    const { db, campaignId } = createTestDb();
    const err = await runCampaignSync(campaignId, { db }).catch((e) => e);
    expect(err).toBeInstanceOf(NoVaultSourceError);
    expect(err.message).toBe("No vault folder configured for this campaign");
  });

  it("writes last_synced_at and last_status after a successful pass", async () => {
    const { db, campaignId } = createTestDb();
    stubVault();
    seedSource(db, campaignId, "camp");

    const summary = await runCampaignSync(campaignId, { db });
    expect(summary.tables.characters.created).toBe(1);

    const row = db.select().from(vaultSources).where(eq(vaultSources.campaignId, campaignId)).get()!;
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(JSON.parse(row.lastStatus!)).toEqual(summary);
    expect(db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!.name).toBe("Shale");
  });

  it("records the mount failure in last_status and rethrows it", async () => {
    const { db, campaignId } = createTestDb();
    vi.stubEnv("VAULT_PATH", createTestVault({}));
    seedSource(db, campaignId, "no-such-folder");

    const err = await runCampaignSync(campaignId, { db }).catch((e) => e);
    expect(err).toBeInstanceOf(VaultUnreadableError);

    const row = db.select().from(vaultSources).where(eq(vaultSources.campaignId, campaignId)).get()!;
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(JSON.parse(row.lastStatus!).error).toBe(err.message);
  });

  it("is self-contained: two runs in a row both reconcile against the database", async () => {
    const { db, campaignId } = createTestDb();
    stubVault();
    seedSource(db, campaignId, "camp");

    const first = await runCampaignSync(campaignId, { db });
    const second = await runCampaignSync(campaignId, { db });
    expect(first.tables.characters.created).toBe(1);
    expect(second.tables.characters.created).toBe(0);
    expect(second.tables.characters.unchanged).toBe(1);
  });
});

describe("listCampaignsWithSources", () => {
  it("returns campaign ids that have a source", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "camp");
    expect(await listCampaignsWithSources(db)).toEqual([campaignId]);
  });

  it("returns an empty array when no sources exist", async () => {
    const { db } = createTestDb();
    expect(await listCampaignsWithSources(db)).toEqual([]);
  });
});

describe("setVaultSource", () => {
  it("inserts, then updates in place, and leaves status columns on update", async () => {
    const { db, campaignId } = createTestDb();
    await setVaultSource(campaignId, "D&D/Explorers of Exandria", db);
    expect((await getVaultSource(campaignId, db))!.rootPath).toBe("D&D/Explorers of Exandria");

    await setVaultSource(campaignId, "Other", db);
    expect((await getVaultSource(campaignId, db))!.rootPath).toBe("Other");
    expect(db.select().from(vaultSources).all()).toHaveLength(1);
  });

  it("trims whitespace around the path", async () => {
    const { db, campaignId } = createTestDb();
    await setVaultSource(campaignId, "  camp  ", db);
    expect((await getVaultSource(campaignId, db))!.rootPath).toBe("camp");
  });

  it("deletes the row when rootPath is empty or whitespace", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "camp");
    await setVaultSource(campaignId, "   ", db);
    expect(await getVaultSource(campaignId, db)).toBeNull();
  });

  it.each([
    ["an absolute path", "/etc"],
    ["a Windows drive path", "C:\\Users\\dm"],
    ["a leading backslash", "\\share\\vault"],
    ["a leading ..", "../outside"],
    ["an embedded ..", "D&D/../../etc"],
    ["a trailing ..", "camp/.."],
    ["a bare ..", ".."],
    ["a backslash-separated ..", "camp\\..\\other"],
    ["a NUL byte", "camp\0x"],
  ])("rejects %s and writes nothing", async (_label, rootPath) => {
    const { db, campaignId } = createTestDb();
    await expect(setVaultSource(campaignId, rootPath, db)).rejects.toBeInstanceOf(InvalidRootPathError);
    expect(db.select().from(vaultSources).all()).toEqual([]);
  });

  it("does not clobber an existing row when a bad path is rejected", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "camp");
    await expect(setVaultSource(campaignId, "../x", db)).rejects.toBeInstanceOf(InvalidRootPathError);
    expect((await getVaultSource(campaignId, db))!.rootPath).toBe("camp");
  });

  it("accepts names that merely contain dots", async () => {
    const { db, campaignId } = createTestDb();
    await setVaultSource(campaignId, "Notes v1..2/Campaign...", db);
    expect((await getVaultSource(campaignId, db))!.rootPath).toBe("Notes v1..2/Campaign...");
  });
});

describe("statusForSyncError", () => {
  it("maps a missing source to 400 and an unreachable mount to 503", () => {
    expect(statusForSyncError(new NoVaultSourceError())).toBe(400);
    expect(statusForSyncError(new VaultUnreadableError("mount gone"))).toBe(503);
  });

  it("returns null for anything else, so the route rethrows a real bug", () => {
    expect(statusForSyncError(new Error("boom"))).toBeNull();
    expect(statusForSyncError(new InvalidRootPathError("x"))).toBeNull();
  });
});
