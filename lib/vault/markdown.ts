import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { parseWikilink, type ParsedWikilink } from "./links";

/**
 * A note's markdown as a flat, renderer-agnostic block model. It is shaped like
 * the old `NotionBlockData` so the consuming components change as little as
 * possible, but it is plain data: no React, no HTML. A later task renders it.
 */

export interface MdInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string | null;
  /** A `[[wikilink]]`. The renderer resolves `target` against the vault. */
  link?: { target: string; kind: "wikilink" };
}

export interface MdBlock {
  /** Index path through the tree (`"2"`, `"2.0"`): stable for identical input. */
  id: string;
  type:
    | "paragraph"
    | "heading"
    | "list_item"
    | "quote"
    | "callout"
    | "divider"
    | "image"
    | "table"
    | "embed"
    | "unsupported";
  /** Heading level, 1 to 6. */
  depth?: number;
  ordered?: boolean;
  inlines?: MdInline[];
  /** The callout type, lowercased. Unknown types are kept as written. */
  calloutType?: string;
  calloutTitle?: string;
  collapsed?: boolean;
  children?: MdBlock[];
  imageTarget?: string;
  embedTarget?: string;
  embedHeading?: string | null;
  /** Table rows, each a list of cells, each cell a run of inlines. Row 0 is the header. */
  rows?: MdInline[][][];
}

type Draft = Omit<MdBlock, "id" | "children"> & { children?: Draft[] };

// mdast types are derived from remark itself rather than imported from
// `mdast`, which is only a transitive dependency.
type Root = ReturnType<ReturnType<typeof remark>["parse"]>;
type FlowNode = Root["children"][number];
type ParagraphNode = Extract<FlowNode, { type: "paragraph" }>;
type PhrasingNode = ParagraphNode["children"][number];
type TextNode = Extract<PhrasingNode, { type: "text" }>;
type BlockquoteNode = Extract<FlowNode, { type: "blockquote" }>;
type ListNode = Extract<FlowNode, { type: "list" }>;
type TableNode = Extract<FlowNode, { type: "table" }>;

interface Marks {
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);

/** `[[...]]` and `![[...]]` inside prose. Newlines never occur inside a link. */
const WIKILINK_TOKEN = /(!?)(\[\[[^[\]\n]+\]\])/g;

/** `[!type]`, optional Obsidian metadata (`[!dm|no-icon]`), then an optional `-`/`+` fold marker. */
const CALLOUT_MARKER = /^\[!([^\]\s|]+)(?:\|[^\]]*)?\]([+-])?/;

const HTML_COMMENTS_ONLY = /^(?:<!--[\s\S]*?-->\s*)+$/;

const markdownParser = remark().use(remarkGfm);

export function parseMarkdown(markdown: string): MdBlock[] {
  const root = markdownParser.parse(markdown);
  return finalize(root.children.flatMap(toBlocks), "");
}

/** Assign each block its index path, so ids depend only on the document itself. */
function finalize(drafts: Draft[], prefix: string): MdBlock[] {
  return drafts.map(({ children, ...rest }, i) => {
    const id = prefix === "" ? String(i) : `${prefix}.${i}`;
    return children ? { id, ...rest, children: finalize(children, id) } : { id, ...rest };
  });
}

// ---------------------------------------------------------------- blocks

function toBlocks(node: FlowNode): Draft[] {
  switch (node.type) {
    case "paragraph":
      return paragraphBlocks(node.children);
    case "heading":
      return [{ type: "heading", depth: node.depth, inlines: inlinesOf(node.children, {}) }];
    case "list":
      return listItems(node);
    case "blockquote":
      return [blockquote(node)];
    case "thematicBreak":
      return [{ type: "divider" }];
    case "table":
      return [table(node)];
    case "code":
      // The model has no code-block type; keep the text, whitespace and all, as one code run.
      return node.value === "" ? [] : [{ type: "paragraph", inlines: [{ text: node.value, code: true }] }];
    case "html":
      // `<!-- Column 1 -->` and friends are layout markers for an Obsidian theme the hub does
      // not implement. They carry no content, so they are dropped rather than kept inert.
      return HTML_COMMENTS_ONLY.test(node.value.trim()) ? [] : [{ type: "unsupported" }];
    case "definition":
      return [];
    default:
      return [{ type: "unsupported" }];
  }
}

function listItems(list: ListNode): Draft[] {
  return list.children.map((item) => {
    const blocks = item.children.flatMap(toBlocks);
    const first = blocks[0];
    // The item's own text is its first paragraph; everything else (further
    // paragraphs, nested lists, embeds) hangs off it as children.
    const ownText = first?.type === "paragraph";
    const children = ownText ? blocks.slice(1) : blocks;
    const draft: Draft = {
      type: "list_item",
      ordered: list.ordered === true,
      inlines: ownText ? first.inlines : [],
    };
    if (children.length > 0) draft.children = children;
    return draft;
  });
}

function table(node: TableNode): Draft {
  return {
    type: "table",
    rows: node.children.map((row) => row.children.map((cell) => inlinesOf(cell.children, {}))),
  };
}

function blockquote(node: BlockquoteNode): Draft {
  const [head, ...rest] = node.children;
  const marker = head?.type === "paragraph" ? calloutMarker(head) : null;
  if (!head || head.type !== "paragraph" || !marker) {
    return { type: "quote", children: node.children.flatMap(toBlocks) };
  }

  const { type, fold, titleNodes, bodyNodes } = marker;
  const title = inlinesOf(titleNodes, {}).map((i) => i.text).join("").trim();
  const draft: Draft = {
    type: "callout",
    calloutType: type,
    collapsed: fold === "-",
    children: [...paragraphBlocks(bodyNodes), ...rest.flatMap(toBlocks)],
  };
  if (title !== "") draft.calloutTitle = title;
  return draft;
}

/**
 * If this paragraph opens with `[!type]`, split it into the marker, the title
 * (the rest of that first line) and the body (everything after it).
 */
function calloutMarker(paragraph: ParagraphNode) {
  const [first, ...others] = paragraph.children;
  if (first?.type !== "text") return null;
  const match = CALLOUT_MARKER.exec(first.value);
  if (!match) return null;

  const afterMarker: TextNode = { ...first, value: first.value.slice(match[0].length) };
  const titleNodes: PhrasingNode[] = [];
  let bodyNodes: PhrasingNode[] = [];

  const queue: PhrasingNode[] = [afterMarker, ...others];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.type === "break") {
      bodyNodes = queue.slice(i + 1);
      break;
    }
    if (node.type === "text") {
      const newline = node.value.indexOf("\n");
      if (newline !== -1) {
        titleNodes.push({ ...node, value: node.value.slice(0, newline) });
        bodyNodes = [{ ...node, value: node.value.slice(newline + 1) }, ...queue.slice(i + 1)];
        break;
      }
    }
    titleNodes.push(node);
  }

  return { type: match[1].toLowerCase(), fold: match[2] ?? null, titleNodes, bodyNodes };
}

// -------------------------------------------------------- paragraphs

/**
 * A paragraph becomes one `paragraph` block, unless it holds a block-level
 * embed (`![[Art.png]]`, `![[Related.base#NPCs]]`) or a markdown image. Those
 * cannot live inside a run of text, so the paragraph is cut around them: text
 * before and after stays as paragraphs and each embed becomes its own block.
 */
function paragraphBlocks(nodes: PhrasingNode[]): Draft[] {
  const blocks: Draft[] = [];
  let run: MdInline[] = [];

  const flush = () => {
    const inlines = trimRun(mergeInlines(run));
    run = [];
    if (inlines.length > 0) blocks.push({ type: "paragraph", inlines });
  };

  for (const node of nodes) {
    if (node.type === "image") {
      flush();
      blocks.push({ type: "image", imageTarget: node.url });
    } else if (node.type === "text") {
      for (const part of splitWikilinks(node.value)) {
        if (part.kind === "embed") {
          flush();
          blocks.push(embedBlock(part.link));
        } else {
          run.push(...partToInlines(part, {}));
        }
      }
    } else {
      run.push(...inlinesOf([node], {}));
    }
  }
  flush();
  return blocks;
}

/** A block for `![[target]]`, decided by the target's extension. */
function embedBlock(link: ParsedWikilink): Draft {
  const extension = extensionOf(link.target);
  if (IMAGE_EXTENSIONS.has(extension)) return { type: "image", imageTarget: link.target };
  if (extension === "base") {
    return { type: "embed", embedTarget: link.target, embedHeading: link.heading };
  }
  // A note transclusion (`![[Some Note]]`, no extension) or a file the hub cannot
  // show (pdf, audio). Flagged unsupported, but the target is kept so a renderer
  // can still point at what was embedded.
  return { type: "unsupported", embedTarget: link.target, embedHeading: link.heading };
}

function extensionOf(target: string): string {
  const dot = target.lastIndexOf(".");
  return dot === -1 ? "" : target.slice(dot + 1).toLowerCase();
}

// ------------------------------------------------------------ inlines

type TextPart =
  | { kind: "text"; text: string }
  | { kind: "link"; link: ParsedWikilink }
  | { kind: "embed"; link: ParsedWikilink };

/**
 * Cut prose around its `[[...]]` and `![[...]]` tokens. The `!` is stripped
 * here, because embed-versus-link is a block-level distinction; what is left
 * goes through `parseWikilink` so the two modules agree on link syntax. A token
 * with no target (`[[]]`) stays as text.
 */
function splitWikilinks(value: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of value.matchAll(WIKILINK_TOKEN)) {
    const link = parseWikilink(match[2]);
    if (!link) continue;
    if (match.index > last) parts.push({ kind: "text", text: value.slice(last, match.index) });
    parts.push({ kind: match[1] === "!" ? "embed" : "link", link });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push({ kind: "text", text: value.slice(last) });
  return parts;
}

function partToInlines(part: TextPart, marks: Marks): MdInline[] {
  if (part.kind === "text") return [withMarks(part.text, marks)];
  // A link, or an embed somewhere a block cannot go (heading, table cell, bold
  // text): both become a link inline so the reference survives.
  const { target, label, heading } = part.link;
  const text = label ?? (heading ? `${target} > ${heading}` : target);
  return [{ ...withMarks(text, marks), link: { target, kind: "wikilink" } }];
}

function withMarks(text: string, marks: Marks, code = false): MdInline {
  const inline: MdInline = { text };
  if (marks.bold) inline.bold = true;
  if (marks.italic) inline.italic = true;
  if (code) inline.code = true;
  if (marks.href) inline.href = marks.href;
  return inline;
}

function inlinesOf(nodes: PhrasingNode[], marks: Marks): MdInline[] {
  return mergeInlines(nodes.flatMap((node) => inlineOf(node, marks)));
}

function inlineOf(node: PhrasingNode, marks: Marks): MdInline[] {
  switch (node.type) {
    case "text":
      return splitWikilinks(node.value).flatMap((part) => partToInlines(part, marks));
    case "strong":
      return node.children.flatMap((c) => inlineOf(c, { ...marks, bold: true }));
    case "emphasis":
      return node.children.flatMap((c) => inlineOf(c, { ...marks, italic: true }));
    case "link":
      return node.children.flatMap((c) => inlineOf(c, { ...marks, href: node.url }));
    case "inlineCode":
      return [withMarks(node.value, marks, true)];
    case "break":
      return [withMarks("\n", marks)];
    case "image":
      return [withMarks(node.alt || node.url, { ...marks, href: node.url })];
    case "html": {
      const value = node.value.trim();
      // `<br>` is a line break; comments and any other inline HTML carry no text.
      return /^<br\s*\/?>$/i.test(value) ? [withMarks("\n", marks)] : [];
    }
    default:
      // Strikethrough, link/image references, footnote references: keep the text, lose the wrapper.
      if ("children" in node) return node.children.flatMap((c) => inlineOf(c as PhrasingNode, marks));
      return "value" in node && typeof node.value === "string" ? [withMarks(node.value, marks)] : [];
  }
}

/** Join neighbouring plain runs that carry identical marks, and drop empty ones. */
function mergeInlines(inlines: MdInline[]): MdInline[] {
  const out: MdInline[] = [];
  for (const inline of inlines) {
    if (inline.text === "") continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      !prev.link &&
      !inline.link &&
      prev.bold === inline.bold &&
      prev.italic === inline.italic &&
      prev.code === inline.code &&
      prev.href === inline.href
    ) {
      prev.text += inline.text;
    } else {
      out.push({ ...inline });
    }
  }
  return out;
}

/** Strip whitespace at the cut edges of a run of text. */
function trimRun(inlines: MdInline[]): MdInline[] {
  if (inlines.length === 0) return inlines;
  const out = inlines.map((i) => ({ ...i }));
  out[0].text = out[0].text.trimStart();
  out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return out.filter((i) => i.text !== "");
}
