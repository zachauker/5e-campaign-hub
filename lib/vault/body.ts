import { createHash } from "node:crypto";
import { parseWikilink } from "./links";

export interface BodyDigest {
  hash: string;
  text: string;
}

/**
 * Derive the two values stored for a note body: `hash` (sha256 hex of the raw
 * markdown) and `text` (plain prose for the full-text search index).
 *
 * The hash covers the raw file, `[!dm]` content included, so editing a DM-only
 * callout still marks dependent briefings stale. The text is a different
 * matter: it is stripped of every `[!dm]` callout, because `text` lands in the
 * search index and `[!dm]` means "behind the screen". That is the same rule
 * `entity_briefings.secret` follows: DM-only content is never indexed.
 * Only `dm` is special; every other callout type keeps its content.
 */
export function digestBody(markdown: string): BodyDigest {
  const hash = createHash("sha256").update(markdown, "utf8").digest("hex");
  return { hash, text: toPlainText(stripDmCallouts(markdown)) };
}

/** Matches a blockquote line, capturing its `>` markers and what follows them. */
const QUOTE_PREFIX = /^\s*((?:>\s?)+)(.*)$/;

/**
 * `[!dm]` with an optional fold suffix (`-` collapsed, `+` expanded) and
 * optional Obsidian callout metadata (`[!dm|x]`), case-insensitively. It must
 * be followed by whitespace or the end of the line, so `[!dmg-roll]` is a
 * different callout type and is not matched.
 */
const DM_MARKER = /^\[!dm(?:\|[^\]]*)?\][+-]?(?:\s|$)/i;

/**
 * Remove every `[!dm]` callout. A callout is a blockquote, so it runs from its
 * `[!dm]` line through every following line quoted at the same depth or deeper;
 * the first line quoted less deeply (a blank line, prose, or the enclosing
 * callout resuming) ends it. A nested `> > [!dm]` therefore drops only the
 * inner block and leaves the outer callout intact.
 */
function stripDmCallouts(markdown: string): string {
  const kept: string[] = [];
  let skipDepth: number | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const quote = QUOTE_PREFIX.exec(line);
    const depth = quote ? (quote[1].match(/>/g) as string[]).length : 0;
    if (skipDepth !== null) {
      if (depth >= skipDepth) continue;
      skipDepth = null;
    }
    if (quote && DM_MARKER.test(quote[2].trimStart())) {
      skipDepth = depth;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

const CALLOUT_MARKER = /^\[![\w-]+(?:\|[^\]]*)?\][+-]?\s*/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Reduce markdown to readable prose for a search index, not for display.
 * Comments (`%%…%%`, `<!--…-->`) are hidden in Obsidian's reading view, so they
 * are dropped rather than indexed. Output is one trimmed, single-spaced line per
 * non-empty source line; blank lines are removed.
 */
function toPlainText(markdown: string): string {
  const withoutComments = markdown.replace(/%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  for (const raw of withoutComments.split(/\r?\n/)) {
    let line = raw;
    const quote = QUOTE_PREFIX.exec(line);
    if (quote) line = quote[2].trimStart().replace(CALLOUT_MARKER, "");

    if (FENCE.test(line) || RULE.test(line)) continue;
    if (line.includes("|") && TABLE_SEPARATOR.test(line)) continue;

    line = line
      .replace(/!\[\[[^\]]*\]\]/g, "") // embeds contribute nothing searchable
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[[^\]]*\]\]/g, (link) => {
        const parsed = parseWikilink(link);
        return parsed ? (parsed.label ?? parsed.target) : "";
      })
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX]\]\s+/, "")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/==([^=]+)==/g, "$1")
      .replace(/(\*{1,3})([^*]+)\1/g, "$2")
      .replace(/(?<![\w])(_{1,3})([^_]+)\1(?![\w])/g, "$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s\^[\w-]+\s*$/, "")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "");

    if (line.trimStart().startsWith("|")) line = line.replace(/\s*\|\s*/g, " ");

    line = line.replace(/\s+/g, " ").trim();
    if (line !== "") out.push(line);
  }
  return out.join("\n");
}
