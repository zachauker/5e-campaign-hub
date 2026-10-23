import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { characters, factions, items, locations, sessionNotes } from "@/lib/db/schema";
import { assertInsideVault } from "./attachments";
import { embedViewFor, resolveEmbed, type EmbedResult } from "./embeds";
import { parseFrontmatter } from "./frontmatter";
import { parseMarkdown, type MdBlock } from "./markdown";
import { assertVaultRelative } from "./paths";

type Db = BetterSQLite3Database<Record<string, unknown>>;

/** What `GET /api/vault/page` returns. `embeds` is keyed by block id. */
export interface VaultPage {
  blocks: MdBlock[];
  embeds: Record<string, EmbedResult>;
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
  for (const block of walk(blocks)) {
    if (block.type !== "embed" || !block.embedHeading) continue;
    const view = embedViewFor(block.embedHeading);
    if (view) embeds[block.id] = resolveEmbed(db, host.campaignId, view, host.kind, host.id);
  }
  return { blocks, embeds };
}
