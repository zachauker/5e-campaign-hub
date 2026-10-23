import fs from "fs";
import path from "path";
import { AttachmentPathError, assertInsideVault } from "./attachments";
import { digestBody } from "./body";
import { VaultUnreadableError, vaultRoot } from "./config";
import { hashContent } from "@/lib/state/content-hash";
import { FrontmatterError, parseFrontmatter } from "./frontmatter";
import { assertVaultRelative, VaultPathError } from "./paths";

/**
 * The plain text of a vault note, for session review.
 *
 * The text is `digestBody(...).text`, not the raw file, on purpose: that strips
 * every `[!dm]` callout, the same rule the search index follows. (Briefings are
 * the one deliberate exception; see `readNoteBody`.) Session review hands this string to a model
 * whose proposals the DM then reads, so behind-the-screen content must not
 * reach it. One rule, one implementation. Frontmatter is dropped first because
 * it is metadata, not narrative.
 *
 * `sourcePath` is the vault-relative path stored on the `session_notes` row.
 * It comes from the database rather than a request, but it is still checked
 * lexically (`assertVaultRelative`) and by realpath (`assertInsideVault`), so a
 * bad row or an in-vault symlink cannot read a file outside the mount.
 *
 * Throws `VaultUnreadableError` when the file (or the whole mount) cannot be
 * read, `VaultPathError` / `AttachmentPathError` for a path that escapes the
 * vault, and `FrontmatterError` for malformed YAML. An empty string is a valid
 * result (a frontmatter-only note); the caller decides what that means.
 */
export async function readNoteText(sourcePath: string): Promise<string> {
  return digestBody((await readNoteBody(sourcePath))).text;
}

/**
 * A note's text together with the watermark a session review is keyed on.
 *
 * Both the review route (which stores the hash) and the review status route
 * (which compares against it) go through here, so the two sides can never hash
 * different things. Hashing a different projection on each side would make
 * `needsReview` permanently wrong.
 */
export async function readNoteForReview(sourcePath: string): Promise<{ text: string; hash: string }> {
  const text = await readNoteText(sourcePath);
  return { text, hash: hashContent(text) };
}

/**
 * The note's RAW body: frontmatter removed, everything else verbatim, `[!dm]`
 * callouts included.
 *
 * This is deliberately not `readNoteText`. It exists for the briefing builder,
 * whose model writes `entity_briefings.secret`, the DM-only field that is
 * never indexed and never rendered on the default card. That field can only be
 * written from material the DM keeps behind the screen, so the model has to see
 * it. Do not hand this to anything that proposes changes the DM reads as
 * campaign fact (session review) or that lands in the search index: those take
 * the stripped text from `readNoteText`.
 *
 * Same guards and errors as `readNoteText`.
 */
export async function readNoteBody(sourcePath: string): Promise<string> {
  assertVaultRelative(sourcePath);

  const root = vaultRoot();
  const full = path.join(root, sourcePath);
  // Checked before the containment guard, which fails closed on anything it
  // cannot resolve: a vanished file is an unreachable vault (transient), not a bad path.
  if (!fs.existsSync(full)) {
    throw new VaultUnreadableError(`The vault note is not reachable: ${sourcePath}`);
  }
  assertInsideVault(root, full);

  let raw: string;
  try {
    raw = fs.readFileSync(full, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VaultUnreadableError(`The vault note could not be read: ${sourcePath} (${reason})`);
  }

  return parseFrontmatter(raw).body;
}

/**
 * Translate a `readNoteText` failure into the response the review route sends,
 * or null for an error this does not recognise (the caller rethrows it).
 * An unreachable vault is 503 — transient infrastructure, the status the
 * Settings panel keys its "vault folder isn't reachable" message off. A stored
 * path that escapes the vault, or a note that cannot be parsed, is 400.
 */
export function reviewSourceFailure(err: unknown): { message: string; status: number } | null {
  if (err instanceof VaultUnreadableError) {
    return { message: `Could not read the vault note: ${err.message}`, status: 503 };
  }
  if (err instanceof VaultPathError || err instanceof AttachmentPathError) {
    return { message: "This session note's vault path is not valid", status: 400 };
  }
  if (err instanceof FrontmatterError) {
    return { message: `Could not read the vault note: ${err.message}`, status: 400 };
  }
  return null;
}
