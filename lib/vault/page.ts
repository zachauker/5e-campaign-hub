import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, factions, items, locations, sessionNotes } from "@/lib/db/schema";
import { assertInsideVault } from "./attachments";
import { embedViewFor, resolveEmbed, type EmbedResult } from "./embeds";
import { parseFrontmatter } from "./frontmatter";
import { parseMarkdown, type MdBlock, type MdInline } from "./markdown";
import { assertVaultRelative, type HubKind } from "./paths";

type Db = BetterSQLite3Database<Record<string, unknown>>;

/** The hub page a wikilink opens. `session` covers encounters and scenes. */
export interface LinkTarget {
  kind: HubKind;
  id: string;
}

/**
 * What `GET /api/vault/page` returns. `embeds` is keyed by block id; `links` by
 * wikilink target as written, `null` for a target that opens nothing.
 */
export interface VaultPage {
  blocks: MdBlock[];
  embeds: Record<string, EmbedResult>;
  links: Record<string, LinkTarget | null>;
}

/** No indexed note has this `source_path`, or its file is no longer on disk. */
export class VaultNoteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultNoteNotFoundError";
  }
}

interface Host {
  campaignId: string;
  /** The `hostKind` vocabulary of `resolveEmbed`. */
  kind: string;
  id: string;
}

/** The hub row a vault path was synced into, or null. */
function findHost(db: Db, sourcePath: string): Host | null {
  const tables = [
    { table: characters, kind: "character" },
    { table: locations, kind: "location" },
    { table: items, kind: "item" },
    { table: factions, kind: "faction" },
    { table: sessionNotes, kind: "session" },
  ] as const;
  for (const { table, kind } of tables) {
    const row = db.select({ id: table.id, campaignId: table.campaignId })
      .from(table)
      .where(eq(table.sourcePath, sourcePath))
      .get();
    if (row) return { campaignId: row.campaignId, kind, id: row.id };
  }
  return null;
}

/** Every block in the tree, including those nested in callouts, quotes and list items. */
function* walk(blocks: MdBlock[]): Generator<MdBlock> {
  for (const block of blocks) {
    yield block;
    if (block.children) yield* walk(block.children);
  }
}

/** Every inline run in a block: its own text and, for a table, each cell. */
function inlinesOf(block: MdBlock): MdInline[] {
  return [...(block.inlines ?? []), ...(block.rows ?? []).flat(2)];
}

/** Compare names the way Obsidian does: Unicode-normalised, case-insensitive. */
const fold = (name: string): string => name.normalize("NFC").toLowerCase();

/**
 * Resolve wikilink targets to hub pages. A mirrored row's `name` is its note's
 * basename and a wikilink target is a basename, so this is a name match within
 * the campaign; the vault is never scanned. A target that matches nothing
 * (a skipped type such as a thread, an alias, or a note that does not exist)
 * maps to `null`: aliases live in frontmatter and never reach the database.
 *
 * Several rows can share a name. The winner is deterministic: the first table in
 * this order (characters, locations, items, factions, session notes), and within
 * a table a live row over an archived one, then the lowest id. Names are folded
 * in JS, not with SQL `lower()`, which only folds ASCII.
 */
export function resolveLinks(
  db: Db, campaignId: string, targets: Iterable<string>,
): Record<string, LinkTarget | null> {
  // A null prototype: a hand-typed `[[__proto__]]` must be an ordinary key.
  const out: Record<string, LinkTarget | null> = Object.create(null);
  const wanted = new Map<string, string[]>();
  for (const t of targets) {
    out[t] = null;
    const key = fold(t);
    wanted.set(key, [...(wanted.get(key) ?? []), t]);
  }
  if (wanted.size === 0) return out;

  const tables = [
    { table: characters, kind: "character" },
    { table: locations, kind: "location" },
    { table: items, kind: "item" },
    { table: factions, kind: "faction" },
    { table: sessionNotes, kind: "session" },
  ] as const;
  const winners = new Map<string, LinkTarget & { archived: boolean }>();
  for (const { table, kind } of tables) {
    const rows = db.select({ id: table.id, name: table.name, archived: table.archived })
      .from(table)
      .where(eq(table.campaignId, campaignId))
      .all();
    for (const row of rows) {
      const key = fold(row.name);
      if (!wanted.has(key)) continue;
      const held = winners.get(key);
      const better = !held
        || (held.kind === kind && ((held.archived && !row.archived) || (held.archived === row.archived && row.id < held.id)));
      if (better) winners.set(key, { kind, id: row.id, archived: row.archived });
    }
  }
  for (const [key, names] of wanted) {
    const hit = winners.get(key);
    if (hit) for (const name of names) out[name] = { kind: hit.kind, id: hit.id };
  }
  return out;
}

/**
 * Read an indexed note's markdown from the vault and parse it for display.
 *
 * Only a path some hub row was synced from is served, not any `.md` that
 * happens to sit under the mount: the page route is reachable by anyone who
 * can reach the hub, and the vault holds notes the sync deliberately skips
 * (`_Templates`, dot-directories). The path is also checked lexically
 * (`assertVaultRelative`) and by realpath (`assertInsideVault`), because a
 * file symlink inside the vault can resolve outside it.
 *
 * Every `![[Related.base#<view>]]` embed whose view the hub can answer is
 * resolved against the note's own row and returned in `embeds`, keyed by block
 * id (stable index paths, so the renderer looks a block up by its own id).
 * Every `[[wikilink]]` target is resolved by `resolveLinks` into `links`.
 *
 * Throws `VaultPathError`, `VaultNoteNotFoundError`, `AttachmentPathError` (a
 * symlink escaping the vault) or `FrontmatterError`; the route maps each.
 */
export function readVaultPage(db: Db, root: string, sourcePath: string): VaultPage {
  assertVaultRelative(sourcePath);

  const host = findHost(db, sourcePath);
  if (!host) throw new VaultNoteNotFoundError("No note is indexed at that path");

  const full = path.join(root, sourcePath);
  if (!fs.existsSync(full)) throw new VaultNoteNotFoundError("The note is no longer in the vault");
  assertInsideVault(root, full);

  let raw: string;
  try {
    raw = fs.readFileSync(full, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultNoteNotFoundError("The note is no longer in the vault");
    }
    throw err;
  }

  const blocks = parseMarkdown(parseFrontmatter(raw).body);
  const embeds: Record<string, EmbedResult> = {};
  const linkTargets = new Set<string>();
  for (const block of walk(blocks)) {
    for (const inline of inlinesOf(block)) if (inline.link) linkTargets.add(inline.link.target);
    if (block.type !== "embed" || !block.embedHeading) continue;
    const view = embedViewFor(block.embedHeading);
    if (view) embeds[block.id] = resolveEmbed(db, host.campaignId, view, host.kind, host.id);
  }
  return { blocks, embeds, links: resolveLinks(db, host.campaignId, linkTargets) };
}
