import path from "path";
import type { EmbedItemKind } from "./embeds";

/** A vault path that is absolute, empty, or climbs out of the vault. */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

/**
 * Throw `VaultPathError` unless `sourcePath` is a plain vault-relative path.
 *
 * Both separators are checked, as `assertRelativeInsideVault` does for the
 * campaign root: a `..` behind a backslash is a traversal on the Windows host
 * that edits the vault. Segments are compared whole, so a filename that merely
 * contains dots (`A.B. Notes.md`, `Wait... what.md`) passes.
 *
 * This is a lexical check only. A file symlink inside the vault can still
 * resolve outside it, so a caller that reads the file must also run the
 * realpath containment guard.
 */
export function assertVaultRelative(sourcePath: string): void {
  if (sourcePath === "") throw new VaultPathError("A vault path is required");
  if (sourcePath.includes("\0")) throw new VaultPathError("The vault path contains an invalid character");
  if (path.isAbsolute(sourcePath) || path.win32.isAbsolute(sourcePath) || /^[\\/]/.test(sourcePath)) {
    throw new VaultPathError("The vault path must be relative to the vault root, not an absolute path");
  }
  if (sourcePath.split(/[\\/]+/).includes("..")) {
    throw new VaultPathError('The vault path must not contain ".." segments');
  }
}

/**
 * Serialise a query string with `URLSearchParams`, so every reserved character
 * in a value is percent-encoded. That matters here: 15 of the vault's notes
 * carry `&` (`Beilar & Elbera.md`), which would otherwise cut the value short,
 * and an em dash or curly apostrophe must survive as UTF-8.
 *
 * URLSearchParams writes a space as `+`. That is right for a form post but
 * Obsidian's URI handler does not decode `+`, so a space is written `%20`
 * instead. A literal `+` in a value is already `%2B`, so the swap is lossless.
 */
function queryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString().replace(/\+/g, "%20");
}

/**
 * The `obsidian://open` uri for a vault-relative note path. An empty vault name
 * (the `vault_name` setting not yet filled in) drops the `vault` param, so
 * Obsidian opens the note in whichever vault it last had focused rather than
 * the link carrying an empty name.
 */
export function obsidianUri(vaultName: string, sourcePath: string): string {
  const params: Record<string, string> = {};
  // Trimmed: a trailing space typed into the Settings field must not become part of the name.
  if (vaultName.trim() !== "") params.vault = vaultName.trim();
  params.file = sourcePath;
  return `obsidian://open?${queryString(params)}`;
}

/** URL of the page route for a vault-relative note path. */
export function vaultPageUrl(sourcePath: string): string {
  return `/api/vault/page?${queryString({ path: sourcePath })}`;
}

/** URL of the attachment route for an embedded image, optionally resized. */
export function attachmentUrl(target: string, width?: number): string {
  const params: Record<string, string> = { target };
  if (width !== undefined) params.w = String(width);
  return `/api/vault/attachment?${queryString(params)}`;
}

/** A kind of hub page a note can link to: the embed kinds plus factions. */
export type HubKind = EmbedItemKind | "faction";

/**
 * The hub page for a row. `session` covers encounters and scenes too, because
 * they are all `session_notes` rows and share the session-note page. The switch
 * is exhaustive: a new kind fails the typecheck here.
 */
export function hubHref(kind: HubKind, id: string): string {
  switch (kind) {
    case "character": return `/characters/${id}`;
    case "item": return `/items/${id}`;
    case "location": return `/locations/${id}`;
    case "faction": return `/factions/${id}`;
    case "session": return `/sessions/${id}`;
  }
}

/** Where a relation-embed row links (a subset of `hubHref`'s kinds). */
export function embedItemHref(kind: EmbedItemKind, id: string): string {
  return hubHref(kind, id);
}

/**
 * The `src` for an image block. `![[Art.png]]` names a vault attachment, which
 * the attachment route finds by basename; `![alt](https://...)` carries a web
 * URL in the same field and must be used as is, because sent to the attachment
 * route it would be matched by basename and could serve an unrelated vault file
 * that happens to share it.
 */
export function imageSrc(target: string, width?: number): string {
  if (/^https?:\/\//i.test(target.trim())) return safeExternalHref(target) ?? "";
  return attachmentUrl(target, width);
}

/**
 * A link target safe to put in an `href`, or null. Note text is hand-written
 * markdown, so `[x](javascript:...)` is possible; only web and mail links are
 * allowed through and anything else renders as plain text. An absolute http(s)
 * or mailto URL is returned as written.
 */
export function safeExternalHref(href: string | null | undefined): string | null {
  if (!href) return null;
  return /^(?:https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null;
}
