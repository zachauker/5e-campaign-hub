import fs from "fs";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, items, factions, locations, sessionNotes } from "@/lib/db/schema";
import { VaultUnreadableError } from "./config";
import { buildLinkIndex } from "./links";
import {
  candidateKeys, mapNote, resolveSourceKey, tableForType,
  type MappedEntity, type VaultEntityTable,
} from "./map";
import { reconcileEntity } from "./reconcile";
import {
  makeEntityRepo, linkCharacterFactions, linkCharacterItems, linkCharacterLocations,
  linkSessionNoteLocations, setLocationParent, type ResolveTargetToKey,
} from "./repos";
import { scanVault, type VaultNote } from "./scan";
import { syncEntityToIndex } from "@/lib/run/index-sync";
import type { SearchKind } from "@/lib/run/search-index";
import type { StateDb } from "@/lib/state/types";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type SyncTable = typeof characters | typeof items | typeof factions | typeof locations | typeof sessionNotes;

export interface SourceSummary {
  created: number; adopted: number; updated: number; unchanged: number; archived: number;
  /** Notes routed to this table that were not written (no name, unmappable). */
  skipped: number;
  warnings: string[]; error?: string;
}

/**
 * Findings that belong to the scan rather than to any one table: a note that
 * could not be parsed, a note whose `type:` is unknown or absent, and the count
 * of notes whose type is recognised but deliberately mirrored nowhere
 * (`thread`, `player-note`, `reference`, `campaign`).
 *
 * These have no table, and attributing them to one would point the DM at the
 * wrong place to look — a malformed NPC note is not a session-notes problem.
 * `vault_sources` is one row per campaign, so the status blob is campaign-scoped
 * already and this is the shape that matches it.
 */
export interface CampaignSummary {
  /** Notes the scan saw but no table claimed. */
  skipped: number;
  warnings: string[];
}

export interface SyncSummary {
  tables: Record<VaultEntityTable, SourceSummary>;
  campaign: CampaignSummary;
}

const TABLES: Record<VaultEntityTable, SyncTable> = {
  characters, items, factions, locations, sessionNotes,
};

// sessionNotes has no entry: it isn't a search-index kind (see SearchKind in
// lib/run/search-index.ts), so its rows are never sent to syncEntityToIndex.
const SEARCH_KIND_FOR_TABLE: Partial<Record<VaultEntityTable, SearchKind>> = {
  characters: "character",
  items: "item",
  factions: "faction",
  locations: "location",
};

/**
 * Dependency order, inherited from the Notion-era loop: factions before
 * characters, characters before items (held_by), locations before session notes
 * (`settings:` name matching).
 *
 * Relations are nonetheless linked in a second pass once every table has been
 * reconciled, because no single order satisfies the vault's edges: a character
 * note names its own `location:` (Notion carried that edge on the location row
 * instead), and a location note names a `parent:` in its own table. Linking
 * last means a target is never missing merely because its table had not been
 * reached yet — on a first sync that would have dropped every character's
 * location and every location's parent until the following tick.
 */
const ORDER: VaultEntityTable[] = ["factions", "characters", "locations", "items", "sessionNotes"];

function emptySummary(): SourceSummary {
  return { created: 0, adopted: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0, warnings: [] };
}

function warnOnce(s: { warnings: string[] }, warning: string): void {
  if (!s.warnings.includes(warning)) s.warnings.push(warning);
}

/** Names listed in one warning before it falls back to "and N more". */
const NAME_LIST_CAP = 10;

/** `"A", "B", "C" and 4 more`, so a mass archive cannot produce a wall of text. */
function quotedList(names: string[]): string {
  const shown = names.slice(0, NAME_LIST_CAP).map((n) => `"${n}"`);
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-check the campaign folder immediately before scanning. Task 9 resolved it
 * through `resolveCampaignFolder`, but a bind mount can drop between that call
 * and this one, and a vanished mount reads as "every note is gone" — the one
 * failure that must never reach the archive step. Mirrors the check in
 * `resolveCampaignFolder` so the route still answers 503.
 */
function assertFolderReadable(folder: string): void {
  try {
    if (!fs.statSync(folder).isDirectory()) {
      throw new VaultUnreadableError(`Vault folder is not a directory: ${folder}`);
    }
    fs.accessSync(folder, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    if (err instanceof VaultUnreadableError) throw err;
    throw new VaultUnreadableError(`Vault folder is not readable: ${folder} (${reason(err)})`);
  }
}

/** `type:` as a string, or undefined when absent or not a scalar string. */
function typeOf(note: VaultNote): string | undefined {
  return typeof note.data.type === "string" ? note.data.type : undefined;
}

/**
 * One pass over a campaign folder: scan, route every note to a hub table by its
 * `type:`, reconcile, link relations, archive what vanished, and re-index.
 *
 * Aborts before touching a single row when the folder is unreadable (throws
 * `VaultUnreadableError`) or holds no markdown at all. Both are what a dropped
 * mount looks like, and archiving on either would hide the whole campaign and
 * dangle every map pin, thread link and briefing that holds an entity id.
 *
 * The summary has two parts: `tables`, one `SourceSummary` per hub table, and
 * `campaign`, for what belongs to the scan rather than to any table.
 */
export async function syncCampaign(opts: {
  db: Db;
  campaignId: string;
  /** Absolute campaign folder, as resolved by `resolveCampaignFolder`. */
  folder: string;
}): Promise<SyncSummary> {
  const { db, campaignId, folder } = opts;
  const tables: Record<VaultEntityTable, SourceSummary> = {
    characters: emptySummary(), items: emptySummary(), factions: emptySummary(),
    locations: emptySummary(), sessionNotes: emptySummary(),
  };
  const summary: SyncSummary = { tables, campaign: { skipped: 0, warnings: [] } };

  // ─── Abort 1: the mount is gone ────────────────────────────────────────────
  assertFolderReadable(folder);

  const scan = scanVault(folder);
  const { notes, warnings: scanWarnings } = scan;

  /**
   * The scan knowingly missed part of the folder: a directory it could not read
   * or a note it could not parse. Those notes are absent from `notes`, so a
   * table full of them is indistinguishable from a table whose notes were
   * deleted — and archiving on that reading would hide live rows and strand
   * every map pin, thread link and briefing holding their ids.
   *
   * Suppression is campaign-wide rather than per table or per key because a
   * parse failure carries neither: the `type:` that would name the table and
   * the `hub_id`/`notion_id` that would name the key both live in the
   * frontmatter that failed to parse, leaving only a path. So all-table
   * suppression is the only sound option, and the right bias — "I could not
   * read all of your vault, so I will not hide anything". Deletions stop
   * propagating until the vault reads cleanly, and the warning says so.
   */
  const scanIncomplete = scan.unreadableDirs.length > 0 || scan.parseFailures.length > 0;

  // ─── Abort 2: not one readable note ───────────────────────────────────────
  if (notes.length === 0) {
    // Per table, not campaign-level: this is the reason each table skipped its
    // own archive step, which is what the DM needs to read beside its counts.
    for (const table of ORDER) {
      tables[table].warnings.push(
        "The campaign folder holds no readable markdown notes; skipped archiving to avoid a mass wipe.",
      );
    }
    for (const warning of scanWarnings) warnOnce(summary.campaign, warning);
    return summary;
  }

  for (const warning of scanWarnings) warnOnce(summary.campaign, warning);

  // ─── The resolver (R1) ────────────────────────────────────────────────────
  // A wikilink target is a note basename, but nearly every row is keyed on
  // `hub_id`/`notion_id`, so a target has to travel basename -> note -> that
  // note's source_key before any linker can look it up. Built once per scan.
  const index = buildLinkIndex(notes);
  // Campaign-level, not per table: a target matching no note anywhere in the
  // vault is a fact about the scan, so the same dead target cited by a character
  // note and an item note warns once rather than once per citing table.
  const misses = new Set<string>();
  const resolve: ResolveTargetToKey = (target) => {
    const note = index.resolve(target);
    if (!note) {
      // A link to a note that exists but has no hub table (a thread, a player
      // note) resolves fine and simply links nothing; only a link matching no
      // note at all is a dead link worth reporting.
      misses.add(target);
      return undefined;
    }
    return resolveSourceKey(note).key;
  };

  // ─── Routing ──────────────────────────────────────────────────────────────
  const byTable: Record<VaultEntityTable, VaultNote[]> = {
    characters: [], items: [], factions: [], locations: [], sessionNotes: [],
  };
  /** Keys of present-but-unroutable notes; no table may archive against them. */
  const unroutedKeys: string[] = [];
  for (const note of notes) {
    const type = typeOf(note);
    const route = tableForType(type);
    if (route === "skip") {
      // Recognised types with no hub table are skipped silently: ~29 notes in
      // the live vault, so warning here would mean 29 warnings every tick.
      summary.campaign.skipped += 1;
      continue;
    }
    if (route === "unknown") {
      summary.campaign.skipped += 1;
      warnOnce(summary.campaign, type === undefined
        ? `Skipped ${note.path}: no type: in its frontmatter`
        : `Skipped ${note.path}: unknown type "${type}"`);
      // The note is present — it just cannot be routed, which is usually a typo
      // (`type: locatoin`). It parsed, so its key IS recoverable even though its
      // table is not, so the key protects its existing row in whichever table
      // that row lives in. One harmless extra key per table, and no entity
      // vanishes from the hub (and the search index) over one mistyped
      // character while the DM fixes it. A recognised-skip type gets no such
      // protection: retyping a note to `thread` is deliberate, and archiving
      // its old row is the same wanted behaviour as any cross-table retype.
      unroutedKeys.push(resolveSourceKey(note).key);
      continue;
    }
    byTable[route].push(note);
  }

  // ─── Reconcile, index and archive, table by table ─────────────────────────
  const linked: Record<VaultEntityTable, { id: string; m: MappedEntity }[]> = {
    characters: [], items: [], factions: [], locations: [], sessionNotes: [],
  };
  for (const table of ORDER) {
    const s = tables[table];
    try {
      await syncTable({
        db, campaignId, table, notes: byTable[table],
        summary: s, synced: linked[table], scanIncomplete, unroutedKeys,
      });
    } catch (err) {
      // A table-level failure (a SQLite error, say) is isolated: the remaining
      // tables still sync and nothing was archived for this one.
      s.error = reason(err);
    }
  }

  // ─── Relations, once every row exists ─────────────────────────────────────
  for (const table of ORDER) {
    const s = tables[table];
    for (const { id, m } of linked[table]) {
      try {
        linkRelations({ db, campaignId, table, id, m, resolve, summary: s });
      } catch (err) {
        s.warnings.push(`Could not link ${m.sourcePath}: ${reason(err)}`);
      }
    }
  }
  for (const target of [...misses].sort()) {
    warnOnce(summary.campaign, `No vault note matches the link "${target}"`);
  }

  return summary;
}

interface TableRun {
  db: Db;
  campaignId: string;
  table: VaultEntityTable;
  notes: VaultNote[];
  summary: SourceSummary;
  /** Filled with each synced row and the note that wrote it, for the link pass. */
  synced: { id: string; m: MappedEntity }[];
  /** True when the scan missed part of the folder; suppresses archiving. */
  scanIncomplete: boolean;
  /**
   * Keys of notes no table could claim. Excluded from this table's archive step
   * without counting towards its mass-wipe guard, which must keep measuring the
   * notes this table actually saw.
   */
  unroutedKeys: string[];
}

async function syncTable(run: TableRun): Promise<void> {
  const { db, campaignId, table, notes, summary: s, synced, scanIncomplete, unroutedKeys } = run;
  const t = TABLES[table];
  // R24: one repo per run. It owns the run's claim map (which note wrote which
  // row), so a repo outliving the run would read a note whose path moved as a
  // collision with its own earlier write and drop its edits for good.
  const repo = makeEntityRepo(db, t, campaignId);

  // Map first, with per-note isolation, so one unmappable note cannot cost the
  // table its scan (and so the two-pass partition below sees every note).
  //
  // The key is taken from the note itself, before and independently of mapping,
  // and recorded for every note the scan handed us: a note that is present but
  // fails to map or to reconcile must still count as seen, or the archive step
  // below would hide the very row it was about to update. `mapNote` sets
  // `sourceKey` from this same `resolveSourceKey`, so the two cannot drift.
  const seenKeys: string[] = [];
  const mapped: { note: VaultNote; m: MappedEntity }[] = [];
  for (const note of notes) {
    seenKeys.push(resolveSourceKey(note).key);
    try {
      mapped.push({ note, m: mapNote(note, table) });
    } catch (err) {
      s.skipped += 1;
      s.warnings.push(`Skipped ${note.path}: ${reason(err)}`);
    }
  }
  // R25: a stable processing order, so which note wins a contested row cannot
  // flap between ticks and carry an entity id (and its map pins) with it.
  mapped.sort((a, b) => (a.m.sourcePath < b.m.sourcePath ? -1 : a.m.sourcePath > b.m.sourcePath ? 1 : 0));

  // R26: two passes. Notes whose own key already matches a row go first, so a
  // note promoting to a new key (basename -> hub_id) cannot take a row out from
  // under the note that is keyed on it exactly. Partitioned before any write,
  // against the rows as this pass found them.
  const exact: typeof mapped = [];
  const rest: typeof mapped = [];
  for (const item of mapped) (repo.findByKey(item.m.sourceKey) ? exact : rest).push(item);

  const collided = new Set<string>();
  /**
   * Notes that created a row while keyed on their basename (no `hub_id`, no
   * `notion_id`). The only identity that can silently fail to carry over, so
   * they are reported if this same pass also archives a row in the table.
   */
  const createdFromBasename: string[] = [];
  for (const { note, m } of [...exact, ...rest]) {
    if (!m.name) {
      s.skipped += 1;
      s.warnings.push(`Skipped ${m.sourcePath}: the note has no name`);
      continue;
    }
    try {
      const result = reconcileEntity(repo, m, candidateKeys(note));
      s[result.action] += 1;
      // R28: `collision` is flagged once per displaced note, so n notes sharing
      // a key flag n-1 times. Deduped by key, and the key is what the warning
      // can name — the flag does not say which path lost.
      if (result.collision) collided.add(m.sourceKey);
      if (result.action === "created" && resolveSourceKey(note).tier === 3) createdFromBasename.push(m.name);

      await indexEntity(db, campaignId, table, result.id);
      synced.push({ id: result.id, m });
    } catch (err) {
      s.skipped += 1;
      s.warnings.push(`Skipped ${m.sourcePath}: ${reason(err)}`);
    }
  }
  for (const key of [...collided].sort()) {
    s.warnings.push(`Two or more notes share the source key "${key}"; only the lowest path is synced.`);
  }

  // The mass-wipe guard, per table and against the keys seen for THIS table —
  // which is also what archives the `characters` row of a note whose `type:`
  // changed to `location`. With nothing verifiably seen the scan cannot be read
  // as "everything is gone", so the rows stay visible and the sync warns.
  if (seenKeys.length === 0) {
    s.warnings.push(`No usable notes for ${table}; skipped archiving to avoid a mass wipe.`);
    return;
  }
  // The second, independent guard: the table saw notes, but the scan did not see
  // all of the folder, so "absent from the scan" does not mean "gone".
  if (scanIncomplete) {
    s.warnings.push(
      "Part of the campaign folder could not be read, so nothing was archived this pass; " +
      "deletions will apply once the whole folder reads cleanly.",
    );
    return;
  }
  const archivedRows = archiveUnseen(db, t, campaignId, [...seenKeys, ...unroutedKeys]);
  for (const { id } of archivedRows) {
    s.archived += 1;
    // An archived entity is invisible in the hub, so it must stop answering
    // run-mode searches too; syncEntityToIndex removes archived rows.
    await indexEntity(db, campaignId, table, id);
  }
  // Archiving is the one destructive outcome, so it is named, not just counted.
  if (archivedRows.length > 0) {
    const names = archivedRows.map((r) => r.name).sort();
    s.warnings.push(
      `Archived ${archivedRows.length} ${archivedRows.length === 1 ? "entry" : "entries"} ` +
      `no longer in the vault: ${quotedList(names)}.`,
    );
    // A note keyed on its basename that created a row in the same pass that
    // archived another is the signature of an identity that did not carry over:
    // the old row (with its map pins, links and briefing) was archived and a
    // blank one took its place.
    if (createdFromBasename.length > 0) {
      s.warnings.push(
        `${quotedList(createdFromBasename.sort())} had no hub_id or notion_id, so ` +
        `${createdFromBasename.length === 1 ? "it was" : "they were"} created from the file name in the same pass ` +
        `that archived ${quotedList(names)}. If one of these is a renamed or re-keyed version of an ` +
        "archived entry, its pins, links and briefing are still on the archived row: do not delete it. " +
        "Give the note a hub_id set to that entry's name, exactly as spelled above. See " +
        "\"A name changed and now there are two entries\" in docs/user-guide/vault-sync.md.",
      );
    }
  }
}

/** Re-index one row, unless its table is not a search kind (session notes). */
async function indexEntity(
  db: Db, campaignId: string, table: VaultEntityTable, id: string,
): Promise<void> {
  const kind = SEARCH_KIND_FOR_TABLE[table];
  if (!kind) return;
  try {
    // `db` here is typed loosely (Record<string, unknown> schema) to stay
    // agnostic of the concrete schema shape; index-sync needs the fully typed
    // StateDb. Same cast pattern as lib/vault/run-sync.ts.
    await syncEntityToIndex(db as unknown as StateDb, campaignId, kind, id);
  } catch (err) {
    // A failed index write must never fail the sync that caused it — the index
    // is a derived convenience and Settings can rebuild it.
    console.warn("[search-index] sync failed:", reason(err));
  }
}

function linkRelations(opts: {
  db: Db; campaignId: string; table: VaultEntityTable; id: string;
  m: MappedEntity; resolve: ResolveTargetToKey; summary: SourceSummary;
}): void {
  const { db, campaignId, table, id, m, resolve, summary: s } = opts;
  switch (table) {
    case "characters":
      if (m.factionTargets?.length) linkCharacterFactions(db, campaignId, id, m.factionTargets, resolve);
      if (m.locationTargets?.length) linkCharacterLocations(db, campaignId, id, m.locationTargets, resolve);
      break;
    case "locations":
      setLocationParent(db, campaignId, id, m.parentTarget, resolve);
      break;
    case "items":
      if (m.heldByTargets?.length) linkCharacterItems(db, campaignId, id, m.heldByTargets, resolve);
      break;
    case "sessionNotes": {
      // Wikilinks are the precise signal; `settings:` is the loose, name-matched
      // legacy field. Prefer the links and fall back to the names only when a
      // note carries none, passing [] for the other list so a note with both
      // does not link twice (and does not warn about a setting it superseded).
      const locationTargets = m.locationTargets ?? [];
      const settingNames = locationTargets.length > 0 ? [] : (m.settingNames ?? []);
      const unmatched = linkSessionNoteLocations(db, campaignId, id, locationTargets, settingNames, resolve);
      for (const name of unmatched) warnOnce(s, `No hub location matches setting "${name}"`);
      break;
    }
    case "factions":
      break;
  }
}

/**
 * Archive (never delete) the rows this table owns that the vault no longer
 * holds: a `source_key` the scan did not see. Rows with no `source_key` are
 * hand-made or world-seeded and are never the vault's to archive. Returns the
 * id and name of each row archived.
 */
function archiveUnseen(
  db: Db, table: SyncTable, campaignId: string, seenKeys: string[],
): { id: string; name: string }[] {
  const t = table as unknown as typeof characters;
  const stale = db.select().from(t).where(and(
    eq(t.campaignId, campaignId),
    sql`${t.sourceKey} IS NOT NULL`,
    eq(t.archived, false),
    notInArray(t.sourceKey, seenKeys),
  )).all();
  if (stale.length === 0) return [];
  const ids = stale.map((r) => r.id);
  db.update(t).set({ archived: true, updatedAt: new Date() }).where(inArray(t.id, ids)).run();
  return stale.map((r) => ({ id: r.id, name: r.name }));
}
