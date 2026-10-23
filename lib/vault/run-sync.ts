import path from "path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { vaultSources, type VaultSource } from "@/lib/db/schema";
import { resolveCampaignFolder, VaultUnreadableError } from "./config";
import { syncCampaign, type SyncSummary } from "./sync";

type SyncDb = BetterSQLite3Database<typeof schema>;

/** The campaign has no vault folder configured. */
export class NoVaultSourceError extends Error {
  constructor() {
    super("No vault folder configured for this campaign");
    this.name = "NoVaultSourceError";
  }
}

/** A `vault_sources.root_path` that is absolute or climbs out of the vault. */
export class InvalidRootPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRootPathError";
  }
}

export interface RunCampaignSyncOpts {
  db?: SyncDb;
}

/**
 * Runs a full sync for one campaign: loads its `vault_sources` row, resolves the
 * folder under the vault mount, runs syncCampaign, and writes back
 * lastSyncedAt / lastStatus. Shared by the manual API route and the background
 * scheduler so both behave identically.
 *
 * Throws NoVaultSourceError when no folder is configured, and
 * InvalidRootPathError when the stored path is absolute or climbs out of the
 * vault (re-checked here because a row can arrive by a route other than
 * `setVaultSource`; the folder is never resolved or scanned in that case). An unreachable mount
 * (VaultUnreadableError) is recorded in lastStatus as `{ error }` and then
 * rethrown, so the route can answer 503 while the Settings panel still has the
 * failure to show on a background tick nobody was watching.
 *
 * Nothing sync-scoped (repos, link indexes) outlives a call: syncCampaign builds
 * its own, so every run reconciles against the database as it is now.
 */
export async function runCampaignSync(campaignId: string, opts: RunCampaignSyncOpts = {}): Promise<SyncSummary> {
  const db = opts.db ?? (defaultDb as unknown as SyncDb);

  const source = await getVaultSource(campaignId, db);
  if (!source) throw new NoVaultSourceError();
  // The write path guards root_path, but a guarantee that holds only for rows
  // written one way is contingent on provenance. Check on read as well.
  assertRelativeInsideVault(source.rootPath);

  let summary: SyncSummary;
  try {
    const folder = resolveCampaignFolder(source.rootPath);
    summary = await syncCampaign({ db: db as never, campaignId, folder });
  } catch (err) {
    if (err instanceof VaultUnreadableError) {
      // Best effort: a failure recording the status must not mask the mount
      // error, or the route answers 500 instead of 503.
      try {
        await db.update(vaultSources)
          .set({ lastSyncedAt: new Date(), lastStatus: JSON.stringify({ error: err.message }) })
          .where(eq(vaultSources.campaignId, campaignId));
      } catch (writeErr) {
        console.error("[vault-sync] could not record the mount failure in last_status", writeErr);
      }
    }
    throw err;
  }

  await db.update(vaultSources)
    .set({ lastSyncedAt: new Date(), lastStatus: JSON.stringify(summary) })
    .where(eq(vaultSources.campaignId, campaignId));

  return summary;
}

/**
 * HTTP status the sync route answers for an error from `runCampaignSync`, or
 * null for one it should not swallow. A missing mount is a transient
 * infrastructure condition rather than a bad request or a bug, so it is 503;
 * the Settings panel keys its "the vault folder isn't reachable" message off it.
 */
export function statusForSyncError(err: unknown): 400 | 503 | null {
  if (err instanceof NoVaultSourceError || err instanceof InvalidRootPathError) return 400;
  if (err instanceof VaultUnreadableError) return 503;
  return null;
}

/** Campaign ids that have a vault folder configured. */
export async function listCampaignsWithSources(db: SyncDb = defaultDb as unknown as SyncDb): Promise<string[]> {
  const rows = await db.select({ campaignId: vaultSources.campaignId }).from(vaultSources);
  return rows.map((r) => r.campaignId);
}

/** The campaign's `vault_sources` row, or null when none is configured. */
export async function getVaultSource(
  campaignId: string,
  db: SyncDb = defaultDb as unknown as SyncDb,
): Promise<VaultSource | null> {
  const row = await db.select().from(vaultSources).where(eq(vaultSources.campaignId, campaignId)).get();
  return row ?? null;
}

/**
 * `resolveCampaignFolder` joins `rootPath` onto the vault mount without a guard
 * of its own, so this is where a path that would escape the mount is turned
 * away. Both separators are checked: a `..` hidden behind a backslash is a
 * traversal on the Windows host that mounts the vault.
 */
function assertRelativeInsideVault(rootPath: string): void {
  if (rootPath.includes("\0")) {
    throw new InvalidRootPathError("The vault folder path contains an invalid character");
  }
  if (path.isAbsolute(rootPath) || path.win32.isAbsolute(rootPath) || /^[\\/]/.test(rootPath)) {
    throw new InvalidRootPathError("The vault folder must be relative to the vault root, not an absolute path");
  }
  if (rootPath.split(/[\\/]+/).includes("..")) {
    throw new InvalidRootPathError('The vault folder path must not contain ".." segments');
  }
}

/**
 * The only writer of `vault_sources.root_path`. Validates before writing, then
 * upserts; an empty (or all-whitespace) path deletes the row. Updating the path
 * leaves lastSyncedAt / lastStatus alone — they describe the previous folder,
 * but the next sync overwrites them and there is no better value to put there.
 */
export async function setVaultSource(
  campaignId: string,
  rawRootPath: string,
  db: SyncDb = defaultDb as unknown as SyncDb,
): Promise<void> {
  const rootPath = rawRootPath.trim();
  if (!rootPath) {
    await db.delete(vaultSources).where(eq(vaultSources.campaignId, campaignId));
    return;
  }
  assertRelativeInsideVault(rootPath);
  await db.insert(vaultSources)
    .values({ campaignId, rootPath })
    .onConflictDoUpdate({ target: vaultSources.campaignId, set: { rootPath } });
}
