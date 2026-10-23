import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { runCampaignSync, listCampaignsWithSources } from "./run-sync";
import { tryAcquireSync, releaseSync } from "./sync-lock";

type SyncDb = BetterSQLite3Database<typeof schema>;

export const VAULT_AUTO_SYNC_ENABLED_KEY = "vault_auto_sync_enabled";
export const VAULT_AUTO_SYNC_INTERVAL_KEY = "vault_auto_sync_interval_minutes";
/**
 * The keys these were renamed from. Still read when the new ones are unset, so
 * an interval the DM chose in the Notion era survives the rename instead of
 * silently resetting to the default.
 */
const LEGACY_ENABLED_KEY = "notion_auto_sync_enabled";
const LEGACY_INTERVAL_KEY = "notion_auto_sync_interval_minutes";
export const DEFAULT_INTERVAL_MINUTES = 15;

export interface AutoSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
}

/**
 * Reads auto-sync config from settings, tolerating missing/garbage values.
 * Each setting falls back to its legacy key only when the vault key has no row
 * at all; a vault key that is present wins even if its value is unusable.
 */
export async function readAutoSyncConfig(db: SyncDb = defaultDb as unknown as SyncDb): Promise<AutoSyncConfig> {
  const rows = await db.query.settings.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const read = (key: string, legacyKey: string) => map.get(key) ?? map.get(legacyKey);

  // Enabled unless explicitly the string "false".
  const enabled = read(VAULT_AUTO_SYNC_ENABLED_KEY, LEGACY_ENABLED_KEY) !== "false";

  const parsed = Number.parseInt(read(VAULT_AUTO_SYNC_INTERVAL_KEY, LEGACY_INTERVAL_KEY) ?? "", 10);
  const intervalMinutes = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_INTERVAL_MINUTES;

  return { enabled, intervalMinutes };
}

export interface TickDeps {
  listCampaigns?: () => Promise<string[]>;
  runOne?: (campaignId: string) => Promise<void>;
  log?: (message: string, err?: unknown) => void;
}

export interface TickResult {
  synced: string[];
  skipped: string[];
  failed: string[];
}

/**
 * Runs one auto-sync pass: for every campaign with a vault folder, acquire the
 * shared lock and sync it. Campaigns already locked (e.g. a manual sync in
 * progress) are skipped. A campaign that throws is isolated — its lock is
 * released and the loop continues.
 */
export async function runAutoSyncTick(deps: TickDeps = {}): Promise<TickResult> {
  const listCampaigns = deps.listCampaigns ?? (() => listCampaignsWithSources());
  const runOne = deps.runOne ?? (async (id: string) => { await runCampaignSync(id); });
  const log = deps.log ?? ((message, err) => console.error(`[vault-auto-sync] ${message}`, err ?? ""));

  const result: TickResult = { synced: [], skipped: [], failed: [] };

  let campaigns: string[];
  try {
    campaigns = await listCampaigns();
  } catch (err) {
    log("failed to list campaigns", err);
    return result;
  }

  for (const campaignId of campaigns) {
    if (!tryAcquireSync(campaignId)) {
      result.skipped.push(campaignId);
      continue;
    }
    try {
      await runOne(campaignId);
      result.synced.push(campaignId);
    } catch (err) {
      result.failed.push(campaignId);
      log(`sync failed for campaign ${campaignId}`, err);
    } finally {
      releaseSync(campaignId);
    }
  }

  return result;
}

const MINUTE_MS = 60_000;
/** Delay before the first tick after boot — short so a fresh container refreshes promptly. */
export const FIRST_TICK_DELAY_MS = 30_000;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export interface TickCycleDeps {
  readConfig?: () => Promise<AutoSyncConfig>;
  runTick?: () => Promise<unknown>;
}

/**
 * Runs one tick — reads config, and if enabled runs the sync pass — then returns
 * the delay in ms until the next tick should fire. Never throws: any failure is
 * logged and the loop reschedules (at the default interval if the config itself
 * could not be read), so a bad tick can't stop the loop. Dependencies are
 * injectable for testing; production uses the real config reader and sync pass.
 */
export async function runTickAndComputeDelay(deps: TickCycleDeps = {}): Promise<number> {
  const readConfig = deps.readConfig ?? (() => readAutoSyncConfig());
  const runTick = deps.runTick ?? (() => runAutoSyncTick());

  let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  try {
    const config = await readConfig();
    intervalMinutes = config.intervalMinutes;
    if (config.enabled) {
      await runTick();
    }
  } catch (err) {
    // Never let a thrown error stop the reschedule loop.
    console.error("[vault-auto-sync] tick error", err);
  }
  return intervalMinutes * MINUTE_MS;
}

async function tickAndReschedule(): Promise<void> {
  const delayMs = await runTickAndComputeDelay();
  timer = setTimeout(() => void tickAndReschedule(), delayMs);
  // Don't keep the event loop alive purely for the sync timer.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * Starts the background auto-sync loop. Idempotent — safe to call once at boot.
 * The first tick fires after FIRST_TICK_DELAY_MS; subsequent ticks use the
 * interval from settings (re-read every tick, so changes take effect live).
 */
export function startVaultSync(): void {
  if (started) return;
  started = true;
  timer = setTimeout(() => void tickAndReschedule(), FIRST_TICK_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}
