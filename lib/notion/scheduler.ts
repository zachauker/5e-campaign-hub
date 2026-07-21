import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { runCampaignSync, listCampaignsWithSources } from "./run-sync";
import { tryAcquireSync, releaseSync } from "./sync-lock";

type SyncDb = BetterSQLite3Database<typeof schema>;

export const AUTO_SYNC_ENABLED_KEY = "notion_auto_sync_enabled";
export const AUTO_SYNC_INTERVAL_KEY = "notion_auto_sync_interval_minutes";
export const DEFAULT_INTERVAL_MINUTES = 15;

export interface AutoSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
}

/** Reads auto-sync config from settings, tolerating missing/garbage values. */
export async function readAutoSyncConfig(db: SyncDb = defaultDb as unknown as SyncDb): Promise<AutoSyncConfig> {
  const rows = await db.query.settings.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  // Enabled unless explicitly the string "false".
  const enabled = map.get(AUTO_SYNC_ENABLED_KEY) !== "false";

  const parsed = Number.parseInt(map.get(AUTO_SYNC_INTERVAL_KEY) ?? "", 10);
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
 * Runs one auto-sync pass: for every campaign with sources, acquire the shared
 * lock and sync it. Campaigns already locked (e.g. a manual sync in progress)
 * are skipped. A campaign that throws is isolated — its lock is released and the
 * loop continues.
 */
export async function runAutoSyncTick(deps: TickDeps = {}): Promise<TickResult> {
  const listCampaigns = deps.listCampaigns ?? (() => listCampaignsWithSources());
  const runOne = deps.runOne ?? (async (id: string) => { await runCampaignSync(id); });
  const log = deps.log ?? ((message, err) => console.error(`[notion-auto-sync] ${message}`, err ?? ""));

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

async function tickAndReschedule(): Promise<void> {
  let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  try {
    const config = await readAutoSyncConfig();
    intervalMinutes = config.intervalMinutes;
    if (config.enabled) {
      await runAutoSyncTick();
    }
  } catch (err) {
    // Never let a thrown error stop the reschedule loop.
    console.error("[notion-auto-sync] tick error", err);
  } finally {
    timer = setTimeout(() => void tickAndReschedule(), intervalMinutes * MINUTE_MS);
    // Don't keep the event loop alive purely for the sync timer.
    if (typeof timer.unref === "function") timer.unref();
  }
}

/**
 * Starts the background auto-sync loop. Idempotent — safe to call once at boot.
 * The first tick fires after FIRST_TICK_DELAY_MS; subsequent ticks use the
 * interval from settings (re-read every tick, so changes take effect live).
 */
export function startNotionAutoSync(): void {
  if (started) return;
  started = true;
  timer = setTimeout(() => void tickAndReschedule(), FIRST_TICK_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}
