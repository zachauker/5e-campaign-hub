import type { SourceSummary, SyncSummary } from "./sync";
import type { VaultEntityTable } from "./map";

/**
 * Pure view-model logic for the Settings vault panel. Kept out of the `.tsx` so
 * the two things that can silently go wrong — reading `vault_sources.last_status`
 * (it holds one of two shapes) and collapsing the duplicated incomplete-scan
 * warning — are covered by tests. Type-only imports: this module is bundled
 * into the client and must not pull in the server-side sync code.
 */

/** Display order and labels; mirrors the section names used elsewhere in Settings. */
export const TABLE_ROWS: ReadonlyArray<{ table: VaultEntityTable; label: string }> = [
  { table: "characters", label: "Characters" },
  { table: "locations", label: "Locations" },
  { table: "items", label: "Items & Loot" },
  { table: "factions", label: "Factions & Organizations" },
  { table: "sessionNotes", label: "Session Timeline" },
];

export interface TableStatus {
  table: VaultEntityTable;
  label: string;
  created: number;
  adopted: number;
  updated: number;
  unchanged: number;
  archived: number;
  skipped: number;
  error?: string;
}

export type SyncStatusView =
  /** The source has never synced. */
  | { kind: "never" }
  /** The last sync failed before producing a summary (e.g. the mount was gone). */
  | { kind: "error"; message: string }
  /** The last sync completed. `warnings` is already de-duplicated. */
  | { kind: "ok"; tables: TableStatus[]; campaignSkipped: number; warnings: string[] }
  /** `last_status` holds something this panel does not know how to read. */
  | { kind: "unrecognised" };

/**
 * Flattens warning lists into one, dropping exact repeats and keeping first-seen
 * order. When a scan is incomplete the sync writes the same "could not be read,
 * so nothing was archived" warning onto all five tables on purpose (it explains
 * each table's zero archive count); showing it five times is noise. This is a
 * display concern, so the summary itself is left as written.
 */
export function dedupeWarnings(lists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const w of list) {
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Reads `vault_sources.last_status` (a JSON string) or the `summary` the sync
 * route returns (an object). On success this is the nested `SyncSummary`; on a
 * mount failure it is `{ error }`, because a campaign-level failure throws
 * rather than being recorded in the summary. `error` is checked first so a
 * failed sync is never rendered as an empty one.
 */
export function parseSyncStatus(raw: unknown): SyncStatusView {
  if (raw === null || raw === undefined || raw === "") return { kind: "never" };

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { kind: "unrecognised" };
    }
  }
  if (!isRecord(value)) return { kind: "unrecognised" };

  if ("error" in value) {
    const message = typeof value.error === "string" && value.error.trim() ? value.error : "The last sync failed";
    return { kind: "error", message };
  }

  if (!isRecord(value.tables)) return { kind: "unrecognised" };
  const summary = value as unknown as Partial<SyncSummary>;
  const byTable = summary.tables as Partial<Record<VaultEntityTable, Partial<SourceSummary>>>;

  const tables: TableStatus[] = TABLE_ROWS.map(({ table, label }) => {
    const t = byTable[table] ?? {};
    return {
      table, label,
      created: num(t.created), adopted: num(t.adopted), updated: num(t.updated),
      unchanged: num(t.unchanged), archived: num(t.archived), skipped: num(t.skipped),
      ...(typeof t.error === "string" && t.error ? { error: t.error } : {}),
    };
  });

  const campaign = isRecord(summary.campaign) ? summary.campaign : { skipped: 0, warnings: [] };
  const warnings = dedupeWarnings([
    strings(campaign.warnings),
    ...TABLE_ROWS.map(({ table }) => strings(byTable[table]?.warnings)),
  ]);

  return { kind: "ok", tables, campaignSkipped: num(campaign.skipped), warnings };
}

/**
 * Message for a failed sync request. A 503 is the expected symptom of a dropped
 * bind mount, so it points the DM at the mount instead of at their notes.
 */
export function describeSyncFailure(status: number, serverMessage: string | undefined): string {
  if (status === 503) {
    return "The vault folder isn't reachable from the server. Check that the vault is still mounted into the container.";
  }
  if (status === 409) return "A sync is already running for this campaign. Try again in a moment.";
  return serverMessage?.trim() || "Sync failed";
}
