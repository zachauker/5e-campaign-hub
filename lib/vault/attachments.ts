import fs from "fs";
import path from "path";
import sharp from "sharp";

/**
 * Extensions the attachment route will resolve at all. This gates resolution,
 * not just serving: a target outside the list never finds a file, so no note,
 * script or config in the vault is reachable through the route even before the
 * containment guard runs.
 */
export const ALLOWED_IMAGE_EXT: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/**
 * Resize bounds for `?w=`. The vault's attachments are character art and
 * screenshots up to tens of MB, so an unclamped, caller-chosen width is a free
 * CPU and memory dial even on a LAN-only app. 2048 covers a full-width view on
 * a hi-dpi laptop; `withoutEnlargement` means a smaller source is never scaled up.
 */
export const MAX_ATTACHMENT_WIDTH = 2048;
export const MIN_ATTACHMENT_WIDTH = 16;

export class AttachmentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathError";
  }
}

export class AttachmentWidthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentWidthError";
  }
}

/** Compare names the way Obsidian does: Unicode-normalised, case-insensitive. */
const fold = (name: string): string => name.normalize("NFC").toLowerCase();

/**
 * Directories never searched, matching the note scan: dot-directories hold the
 * pre-migration backups (which carry stale copies of the same attachments) and
 * tooling state; `_Templates` is not live content.
 */
const isExcludedDir = (name: string): boolean => name === "_Templates" || name.startsWith(".");

/** Dot-files include AppleDouble `._Foo.png` resource forks written by the Mac. */
const isExcludedFile = (name: string): boolean => name.startsWith(".");

interface Candidate {
  full: string;
  /** Exact (normalised) name match rather than only a case-insensitive one. */
  exact: boolean;
  depth: number;
  rel: string;
}

/**
 * Find a file whose basename matches `target` anywhere under `vaultRoot` and
 * return its absolute real path, or `null`.
 *
 * `![[img.png]]` names a file, not a path, so only the last segment of `target`
 * is used and the whole vault is searched, as Obsidian does. Directory
 * symlinks are not followed, so the walk stays inside the tree.
 *
 * With several matches the choice is deterministic: an exact-case match beats
 * a case-only one, then the shallowest, then the lexicographically first
 * vault-relative path. Shallowest-first is Obsidian's own tie-break for an
 * ambiguous link; the final path ordering makes the result independent of
 * directory enumeration order.
 *
 * The result is not checked for containment — a file symlink can resolve
 * outside the vault. Callers serve it only after `assertInsideVault`
 * (`locateAttachment` does both).
 */
export function resolveAttachment(vaultRoot: string, target: string): string | null {
  if (target.includes("\0")) return null;
  const base = target.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base === "" || base.startsWith(".")) return null;
  if (!ALLOWED_IMAGE_EXT.includes(path.extname(base).toLowerCase())) return null;

  const wanted = fold(base);
  const wantedExact = base.normalize("NFC");
  const candidates: Candidate[] = [];

  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable directory just contributes no candidates
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) walk(full, depth + 1);
        continue;
      }
      if (isExcludedFile(entry.name) || fold(entry.name) !== wanted) continue;
      // A symlinked file is a candidate (stat follows it); a symlinked
      // directory or anything else that is not a regular file is not.
      if (!entry.isFile() && !(entry.isSymbolicLink() && isRegularFile(full))) continue;
      candidates.push({
        full,
        exact: entry.name.normalize("NFC") === wantedExact,
        depth,
        rel: path.relative(vaultRoot, full).split(path.sep).join("/"),
      });
    }
  };
  walk(vaultRoot, 0);

  candidates.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) || a.depth - b.depth || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0),
  );
  const best = candidates[0];
  if (!best) return null;
  try {
    return fs.realpathSync(best.full);
  } catch {
    return null; // dangling symlink
  }
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Throw `AttachmentPathError` unless the resolved real path of `absPath` is
 * strictly inside the resolved real path of `vaultRoot`.
 *
 * Both sides go through `realpath`. Resolving only `absPath` falsely rejects
 * every file when the root is reached through a symlink (macOS `/tmp`,
 * `/var/folders`, a mount alias); resolving neither is a string-prefix check,
 * which accepts a symlink inside the vault that points outside it. A path that
 * cannot be resolved (missing, dangling, unreadable) is rejected: this fails
 * closed.
 */
export function assertInsideVault(vaultRoot: string, absPath: string): void {
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = fs.realpathSync(vaultRoot);
    realPath = fs.realpathSync(absPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AttachmentPathError(`Cannot resolve attachment path: ${reason}`);
  }
  const rel = path.relative(realRoot, realPath);
  // Compare whole segments: a file legitimately named `..notes.png` must not be
  // mistaken for a parent traversal, nor `/vault-evil` for being under `/vault`.
  const escapes = rel === ".." || rel.startsWith(".." + path.sep);
  if (rel === "" || escapes || path.isAbsolute(rel)) {
    throw new AttachmentPathError("Attachment path is outside the vault");
  }
}

export interface LocatedAttachment {
  /** Absolute real path, already verified to be inside the vault. */
  path: string;
  contentType: string;
}

/** Resolve `target` and verify containment. `null` when nothing matches; throws `AttachmentPathError` on an escape. */
export function locateAttachment(vaultRoot: string, target: string): LocatedAttachment | null {
  const found = resolveAttachment(vaultRoot, target);
  if (!found) return null;
  assertInsideVault(vaultRoot, found);
  const contentType = CONTENT_TYPES[path.extname(found).toLowerCase()];
  return contentType ? { path: found, contentType } : null;
}

/**
 * Parse the `?w=` query value. Absent or empty means "original size" (`null`).
 * Anything but a plain positive integer is an error; a valid integer is clamped
 * into [MIN_ATTACHMENT_WIDTH, MAX_ATTACHMENT_WIDTH].
 */
export function parseWidth(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) throw new AttachmentWidthError(`Invalid width: ${raw.slice(0, 32)}`);
  return Math.min(MAX_ATTACHMENT_WIDTH, Math.max(MIN_ATTACHMENT_WIDTH, Number(raw)));
}

/** Downscale a raster image to `width` (never up), keeping its format. Not for SVG. */
export async function renderResized(absPath: string, width: number): Promise<Buffer> {
  const ext = path.extname(absPath).toLowerCase();
  return sharp(absPath, { animated: ext === ".gif" || ext === ".webp", sequentialRead: true })
    .rotate() // apply EXIF orientation before the metadata is dropped
    .resize({ width, withoutEnlargement: true })
    .toBuffer();
}
