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
 * optional Obsidian callout metadata (`[!dm|x]`), case-insensitively. Nothing
 * may be required after the closing bracket: a title jammed against it
 * (`[!dm]Title`, `[!dm]-Title`) is still a DM callout, and a missed match here
 * would index the whole callout as ordinary prose. The closing `]` is what
 * separates `dm` from a different type such as `[!dmg-roll]`, which is not matched.
 */
const DM_MARKER = /^\[!dm(?:\|[^\]]*)?\][+-]?/i;

/**
 * A line that opens a new block construct. These interrupt a paragraph rather
 * than continuing it, so they cannot be a lazy continuation: ATX heading,
 * thematic break, code fence, or a bullet or `1.` list item. An ordered list
 * only interrupts a paragraph when it starts at 1 (CommonMark), so `2. text`
 * after a quoted line is a lazy continuation and is not an opener.
 */
const BLOCK_OPENER = /^\s{0,3}(?:#{1,6}(?:\s|$)|(?:[-*_])(?:\s*[-*_]){2,}\s*$|```|~~~|(?:[-*+]|1[.)])(?:\s|$))/;

/**
 * Remove every `[!dm]` callout. A callout is a blockquote, so it runs from its
 * `[!dm]` line through every following line quoted at the same depth or deeper.
 *
 * It also takes in lazy continuation lines: in CommonMark and Obsidian a
 * non-blank, unquoted line directly after a quoted line continues that
 * blockquote's paragraph, so Obsidian renders it inside the (possibly
 * collapsed) `[!dm]` callout and the DM reasonably believes it is hidden.
 * Indexing it would leak DM-only prose, so it is dropped too. A blank line, a
 * line quoted less deeply than the callout, or a line opening a new block
 * construct (see BLOCK_OPENER) ends the callout. A nested `> > [!dm]` therefore
 * drops only the inner block and leaves the outer callout intact.
 */
function stripDmCallouts(markdown: string): string {
  const kept: string[] = [];
  let skipDepth: number | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const quote = QUOTE_PREFIX.exec(line);
    const depth = quote ? (quote[1].match(/>/g) as string[]).length : 0;
    if (skipDepth !== null) {
      const lazyContinuation = depth === 0 && line.trim() !== "" && !BLOCK_OPENER.test(line);
      if (depth >= skipDepth || lazyContinuation) continue;
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
 * Comments (`%%…%%`, `<!--…-->`) are dropped deliberately, not by accident: both
 * are hidden in Obsidian's reading view, so the DM does not consider them prose
 * (the vault uses `<!-- Column 1 -->` as layout markers) and they should not be
 * indexed. Pairing is document-wide, so two unrelated lone `%%` swallow
 * everything between them; an unterminated one matches nothing. Output is one
 * trimmed, single-spaced line per non-empty source line; blank lines are removed.
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
        if (parsed) return parsed.label ?? parsed.target;
        // A same-note heading link (`[[#History]]`) has no target; keep its
        // visible text (the label, else the heading) in the index.
        const [anchor, label] = link.slice(2, -2).split("|");
        return label?.trim() || anchor.replace(/^\s*#/, "").trim();
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
