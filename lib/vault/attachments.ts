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
 * Resize bounds for `?w=`. The clamp bounds the *output* only: it stops a caller
 * asking for an enormous encode, but every request still decodes the source at
 * full resolution before shrinking it (`?w=16` on the biggest PNG pays the same
 * decode as `?w=2048`). The decode is bounded separately, by
 * `MAX_INPUT_PIXELS` per image and `MAX_CONCURRENT_RESIZES` at once. 2048
 * covers a full-width view on a hi-dpi laptop; `withoutEnlargement` means a
 * smaller source is never scaled up.
 */
export const MAX_ATTACHMENT_WIDTH = 2048;
export const MIN_ATTACHMENT_WIDTH = 16;

/**
 * Largest source image (width x height) the resizer will decode. The real
 * vault is 22 files / 64 MB of character art and screenshots, so the largest
 * is on the order of 10-20 MB of PNG, i.e. well under 50 megapixels; 100 MP
 * (10000x10000) leaves roughly 2x headroom while capping a single decode near
 * 400 MB of RGBA instead of sharp's ~268 MP / ~1 GB default. Raise it if the DM
 * adds genuinely larger art.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Resizes allowed to decode at once. Each can hold hundreds of MB, and a page
 * full of embeds fires them in parallel; a small fixed bound keeps the peak at
 * a few images. Done here rather than with `sharp.concurrency()`, which is
 * process-global and would also throttle map tiling.
 */
export const MAX_CONCURRENT_RESIZES = 2;

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
    } catch (err) {
      // An unreadable directory just contributes no candidates, but say so:
      // otherwise a permissions problem on the share looks like a missing image.
      console.warn(`[vault] attachment search skipped ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return;
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
  // Compare whole segments, not string prefixes: the sibling `/vault-evil` is
  // not under `/vault` even though its path starts with the same characters,
  // and a segment test (`..` or `../...`) is what path.relative actually emits
  // for an escape.
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
  // Deliberately the extension of the *real path*, not of `target`. The
  // resolver only vetted the name it matched, but `found` is where that name
  // pointed: an in-vault symlink `x.png -> Notes/secret.md` passes containment
  // (it really is inside the vault) and must still not be served as an image.
  // Looking the type up post-realpath is what stops it. Do not "simplify" this
  // to derive the type from `target`.
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
  // Fixed message: the raw value is attacker-controlled and must not be echoed.
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) throw new AttachmentWidthError("w must be a positive integer");
  return Math.min(MAX_ATTACHMENT_WIDTH, Math.max(MIN_ATTACHMENT_WIDTH, Number(raw)));
}

let activeResizes = 0;
const resizeQueue: Array<() => void> = [];

async function withResizeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeResizes >= MAX_CONCURRENT_RESIZES) {
    await new Promise<void>((resolve) => resizeQueue.push(resolve));
  } else {
    activeResizes++;
  }
  try {
    return await task();
  } finally {
    // Hand the slot straight to the next waiter, or free it.
    const next = resizeQueue.shift();
    if (next) next();
    else activeResizes--;
  }
}

/**
 * Downscale a raster image to `width` (never up), keeping its format. Not for
 * SVG. A source over `limitInputPixels` is refused (sharp throws) before it is
 * decoded; at most `MAX_CONCURRENT_RESIZES` run at a time.
 */
export function renderResized(
  absPath: string,
  width: number,
  limitInputPixels: number = MAX_INPUT_PIXELS,
): Promise<Buffer> {
  const ext = path.extname(absPath).toLowerCase();
  return withResizeSlot(() =>
    sharp(absPath, { animated: ext === ".gif" || ext === ".webp", sequentialRead: true, limitInputPixels })
      // Auto-orient from EXIF before the metadata is dropped. sharp runs this
      // ahead of the resize whatever the call order; measured on an 8000x6000
      // JPEG it costs nothing against omitting it, so shrink-on-load is intact.
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .toBuffer(),
  );
}
