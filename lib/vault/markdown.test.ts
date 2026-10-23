import { describe, expect, it } from "vitest";
import { parseMarkdown, type MdBlock } from "./markdown";

/** The plain text of an inline run, to assert on content without caring about its marks. */
const textOf = (b: MdBlock | undefined) => (b?.inlines ?? []).map((i) => i.text).join("");

describe("parseMarkdown", () => {
  it("maps headings with their depth", () => {
    const blocks = parseMarkdown("# One\n\n## Two\n\n###### Six");
    expect(blocks.map((b) => [b.type, b.depth, textOf(b)])).toEqual([
      ["heading", 1, "One"],
      ["heading", 2, "Two"],
      ["heading", 6, "Six"],
    ]);
  });

  it("maps paragraphs with bold, italic, code and links as inlines", () => {
    const [p] = parseMarkdown("Plain **bold** and *italic* and `code` and [site](https://example.com/x).");
    expect(p.type).toBe("paragraph");
    expect(p.inlines).toEqual([
      { text: "Plain " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
      { text: " and " },
      { text: "code", code: true },
      { text: " and " },
      { text: "site", href: "https://example.com/x" },
      { text: "." },
    ]);
  });

  it("combines marks that nest", () => {
    const [p] = parseMarkdown("***both*** and **[bold link](https://example.com)**");
    expect(p.inlines).toEqual([
      { text: "both", bold: true, italic: true },
      { text: " and " },
      { text: "bold link", bold: true, href: "https://example.com" },
    ]);
  });

  it("maps bulleted and numbered list items, marking ordered", () => {
    const blocks = parseMarkdown("- apple\n- pear\n\n1. first\n2. second");
    expect(blocks.map((b) => [b.type, b.ordered, textOf(b)])).toEqual([
      ["list_item", false, "apple"],
      ["list_item", false, "pear"],
      ["list_item", true, "first"],
      ["list_item", true, "second"],
    ]);
  });

  it("carries task-list state: unchecked, checked, and no checkbox", () => {
    const blocks = parseMarkdown("- [ ] open\n- [x] done\n- plain");
    expect(blocks.map((b) => [textOf(b), b.checked])).toEqual([
      ["open", false],
      ["done", true],
      ["plain", undefined],
    ]);
  });

  it("carries checked state on a nested task and an ordered task", () => {
    const [item, ordered] = parseMarkdown("- [ ] parent\n  - [x] child\n\n1. [x] first");
    expect(item.checked).toBe(false);
    expect(item.children?.[0]).toMatchObject({ type: "list_item", checked: true });
    expect(ordered).toMatchObject({ ordered: true, checked: true });
  });

  it("carries strikethrough as a strike mark", () => {
    const [p] = parseMarkdown("Keep ~~Is the vault retracted?~~ and **~~bold struck~~** end.");
    expect(p.inlines).toEqual([
      { text: "Keep " },
      { text: "Is the vault retracted?", strike: true },
      { text: " and " },
      { text: "bold struck", bold: true, strike: true },
      { text: " end." },
    ]);
  });

  it("keeps a strike on a wikilink inside struck text", () => {
    const [p] = parseMarkdown("~~[[Rexxentrum]]~~");
    expect(p.inlines).toEqual([
      { text: "Rexxentrum", strike: true, link: { target: "Rexxentrum", kind: "wikilink" } },
    ]);
  });

  it("nests a sub-list under its parent list item as children", () => {
    const [item] = parseMarkdown("- parent\n  - child\n  - other child");
    expect(textOf(item)).toBe("parent");
    expect(item.children?.map((c) => [c.type, c.ordered, textOf(c)])).toEqual([
      ["list_item", false, "child"],
      ["list_item", false, "other child"],
    ]);
  });

  it("maps a divider", () => {
    const blocks = parseMarkdown("above\n\n---\n\nbelow");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
  });

  it("maps a GFM table to rows of cells", () => {
    const [t] = parseMarkdown("| Name | HP |\n| --- | --- |\n| Bartlebee | 12 |\n| **Wasp** | 3 |");
    expect(t.type).toBe("table");
    expect(t.rows).toEqual([
      [[{ text: "Name" }], [{ text: "HP" }]],
      [[{ text: "Bartlebee" }], [{ text: "12" }]],
      [[{ text: "Wasp", bold: true }], [{ text: "3" }]],
    ]);
  });

  it("maps a six-column table with a wikilink in a cell", () => {
    const md = [
      "| NPC | Race | Role | Where | Mood | Notes |",
      "| --- | --- | --- | --- | --- | --- |",
      "| [[Bartlebee]] | Kobold | Cook | Tavern | Wary | Owes a debt |",
    ].join("\n");
    const [t] = parseMarkdown(md);
    expect(t.rows).toHaveLength(2);
    expect(t.rows?.every((r) => r.length === 6)).toBe(true);
    expect(t.rows?.[1][0]).toEqual([
      { text: "Bartlebee", link: { target: "Bartlebee", kind: "wikilink" } },
    ]);
  });

  it("keeps an escaped pipe wikilink label inside one table cell", () => {
    const [t] = parseMarkdown("| A | B |\n| --- | --- |\n| [[Rexxentrum\\|the capital]] | x |");
    expect(t.rows?.[1]).toHaveLength(2);
    expect(t.rows?.[1][0]).toEqual([
      { text: "the capital", link: { target: "Rexxentrum", kind: "wikilink" } },
    ]);
  });

  it("maps a plain blockquote to a quote, not a callout", () => {
    const [q] = parseMarkdown("> Just a quotation.\n>\n> Second paragraph.");
    expect(q.type).toBe("quote");
    expect(q.calloutType).toBeUndefined();
    expect(q.children?.map((c) => [c.type, textOf(c)])).toEqual([
      ["paragraph", "Just a quotation."],
      ["paragraph", "Second paragraph."],
    ]);
  });

  it("maps a callout with its type and title", () => {
    const [b] = parseMarkdown("> [!describe] At the Table\n> Tall and spare.");
    expect(b.type).toBe("callout");
    expect(b.calloutType).toBe("describe");
    expect(b.calloutTitle).toBe("At the Table");
    expect(b.collapsed).toBe(false);
  });

  it("marks a collapsed callout", () => {
    expect(parseMarkdown("> [!dm]- Secret\n> Hidden.")[0].collapsed).toBe(true);
  });

  it("treats a [!type]+ callout as not collapsed", () => {
    const [b] = parseMarkdown("> [!tip]+ Open by default\n> Body.");
    expect(b).toMatchObject({ type: "callout", calloutType: "tip", calloutTitle: "Open by default", collapsed: false });
  });

  it("lowercases the callout type", () => {
    expect(parseMarkdown("> [!DM] Secret\n> Hidden.")[0].calloutType).toBe("dm");
    expect(parseMarkdown("> [!Read-Aloud]\n> Boxed text.")[0].calloutType).toBe("read-aloud");
  });

  it("preserves callout body blocks as children", () => {
    const [b] = parseMarkdown("> [!check] Perception\n> DC 15 to notice.\n>\n> - On a 20, also the key\n> - On a 10, the draft");
    expect(b.children?.map((c) => [c.type, textOf(c)])).toEqual([
      ["paragraph", "DC 15 to notice."],
      ["list_item", "On a 20, also the key"],
      ["list_item", "On a 10, the draft"],
    ]);
  });

  it("puts the rest of the marker paragraph into the body, not the title", () => {
    const [b] = parseMarkdown("> [!lore] The Founding\n> Long ago, **before** the war.");
    expect(b.calloutTitle).toBe("The Founding");
    expect(b.children).toHaveLength(1);
    expect(b.children?.[0].inlines).toEqual([
      { text: "Long ago, " },
      { text: "before", bold: true },
      { text: " the war." },
    ]);
  });

  it("gives a callout with no title and a body on the next line", () => {
    const [b] = parseMarkdown("> [!read-aloud]\n> The door creaks open.");
    expect(b.calloutType).toBe("read-aloud");
    expect(b.calloutTitle).toBeUndefined();
    expect(textOf(b.children?.[0])).toBe("The door creaks open.");
  });

  it("keeps a # and inline formatting inside a callout title", () => {
    const [b] = parseMarkdown("> [!combat] Round #3 with **Wasps**\n> Roll initiative.");
    expect(b.calloutTitle).toBe("Round #3 with Wasps");
  });

  it("keeps an unknown callout type rather than dropping the block", () => {
    const [b] = parseMarkdown("> [!widget] Gizmo\n> Spins.");
    expect(b).toMatchObject({ type: "callout", calloutType: "widget", calloutTitle: "Gizmo" });
    expect(textOf(b.children?.[0])).toBe("Spins.");
  });

  it("ignores callout metadata after the type", () => {
    const [b] = parseMarkdown("> [!dm|no-icon]- Secret\n> Hidden.");
    expect(b).toMatchObject({ type: "callout", calloutType: "dm", collapsed: true, calloutTitle: "Secret" });
  });

  it("nests a callout inside a callout", () => {
    const [outer] = parseMarkdown("> [!info] Outer\n> Text.\n>\n> > [!dm]- Inner\n> > Secret.");
    expect(outer.calloutType).toBe("info");
    const inner = outer.children?.find((c) => c.type === "callout");
    expect(inner).toMatchObject({ calloutType: "dm", calloutTitle: "Inner", collapsed: true });
    expect(textOf(inner?.children?.[0])).toBe("Secret.");
  });

  it("does not treat a [!x] that is not at the start of a quote as a callout", () => {
    expect(parseMarkdown("> Not a callout [!dm] here.")[0].type).toBe("quote");
    expect(parseMarkdown("[!dm] outside a quote")[0].type).toBe("paragraph");
  });

  it("maps an image embed to its target", () => {
    expect(parseMarkdown("![[Bartlebee_GeneratedArt.png]]")[0]).toMatchObject({
      type: "image",
      imageTarget: "Bartlebee_GeneratedArt.png",
    });
  });

  it("recognises every image extension, case-insensitively", () => {
    for (const name of ["a.png", "b.jpg", "c.jpeg", "d.webp", "e.gif", "f.svg", "G.PNG"]) {
      expect(parseMarkdown(`![[${name}]]`)[0]).toMatchObject({ type: "image", imageTarget: name });
    }
  });

  it("drops an image size hint and a folder prefix from the target", () => {
    expect(parseMarkdown("![[Attachments/Map.png|400]]")[0]).toMatchObject({
      type: "image",
      imageTarget: "Map.png",
    });
  });

  it("maps a base embed to an embed block with its heading", () => {
    expect(parseMarkdown("![[Related.base#NPCs here]]")[0]).toMatchObject({
      type: "embed",
      embedTarget: "Related.base",
      embedHeading: "NPCs here",
    });
  });

  it("maps a base embed with no heading to a null heading", () => {
    expect(parseMarkdown("![[Related.base]]")[0]).toMatchObject({
      type: "embed",
      embedTarget: "Related.base",
      embedHeading: null,
    });
  });

  it("maps an extension-less note transclusion to unsupported, keeping its target", () => {
    expect(parseMarkdown("![[Some Note#Section]]")[0]).toMatchObject({
      type: "unsupported",
      embedTarget: "Some Note",
      embedHeading: "Section",
    });
  });

  it("maps an unrenderable file embed (pdf) to unsupported", () => {
    expect(parseMarkdown("![[Handout.pdf]]")[0]).toMatchObject({ type: "unsupported", embedTarget: "Handout.pdf" });
  });

  it("splits a paragraph around an embed, keeping the text on both sides", () => {
    const blocks = parseMarkdown("Before the art.\n![[Art.png]]\nAfter the art.");
    expect(blocks.map((b) => [b.type, textOf(b) || b.imageTarget])).toEqual([
      ["paragraph", "Before the art."],
      ["image", "Art.png"],
      ["paragraph", "After the art."],
    ]);
  });

  it("maps consecutive embeds in one paragraph to separate blocks with no empty paragraphs", () => {
    const blocks = parseMarkdown("![[Related.base#NPCs here]]\n![[Related.base#Places]]");
    expect(blocks.map((b) => [b.type, b.embedHeading])).toEqual([
      ["embed", "NPCs here"],
      ["embed", "Places"],
    ]);
  });

  it("maps an embed inside a callout body to a child block", () => {
    const [b] = parseMarkdown("> [!map] Overview\n> ![[Cave.png]]");
    expect(b.children?.[0]).toMatchObject({ type: "image", imageTarget: "Cave.png" });
  });

  it("maps a markdown image to an image block with its url", () => {
    expect(parseMarkdown("![alt](https://example.com/p.png)")[0]).toMatchObject({
      type: "image",
      imageTarget: "https://example.com/p.png",
    });
  });

  it("maps an inline wikilink to a link inline", () => {
    const [p] = parseMarkdown("Travel to [[Rexxentrum|the capital]] soon.");
    expect(p.inlines).toEqual([
      { text: "Travel to " },
      { text: "the capital", link: { target: "Rexxentrum", kind: "wikilink" } },
      { text: " soon." },
    ]);
  });

  it("uses the target as the text of an unlabelled wikilink", () => {
    const [p] = parseMarkdown("See [[Bartlebee]].");
    expect(p.inlines?.[1]).toEqual({ text: "Bartlebee", link: { target: "Bartlebee", kind: "wikilink" } });
  });

  it("resolves a path-qualified wikilink on its last segment", () => {
    const [p] = parseMarkdown("[[Locations/Blackvein Quarry]]");
    expect(p.inlines).toEqual([
      { text: "Blackvein Quarry", link: { target: "Blackvein Quarry", kind: "wikilink" } },
    ]);
  });

  it("shows a heading link as Note > heading when it has no label", () => {
    const [p] = parseMarkdown("[[Rexxentrum#History]]");
    expect(p.inlines).toEqual([
      { text: "Rexxentrum > History", link: { target: "Rexxentrum", kind: "wikilink" } },
    ]);
  });

  it("carries bold onto a wikilink inside bold text", () => {
    const [p] = parseMarkdown("**[[Rexxentrum]]**");
    expect(p.inlines).toEqual([
      { text: "Rexxentrum", bold: true, link: { target: "Rexxentrum", kind: "wikilink" } },
    ]);
  });

  it("keeps non-ASCII link targets intact", () => {
    const [p] = parseMarkdown("Visit [[Zhūwǎng Café|the café]] and [[Ærin Þorn]].");
    expect(p.inlines).toEqual([
      { text: "Visit " },
      { text: "the café", link: { target: "Zhūwǎng Café", kind: "wikilink" } },
      { text: " and " },
      { text: "Ærin Þorn", link: { target: "Ærin Þorn", kind: "wikilink" } },
      { text: "." },
    ]);
  });

  it("leaves wikilink syntax inside a code span alone", () => {
    const [p] = parseMarkdown("Type `[[Not A Link]]` literally.");
    expect(p.inlines?.some((i) => i.link)).toBe(false);
    expect(p.inlines?.[1]).toEqual({ text: "[[Not A Link]]", code: true });
  });

  it("leaves a wikilink with no target as plain text", () => {
    expect(textOf(parseMarkdown("empty [[]] link")[0])).toBe("empty [[]] link");
  });

  it("renders a wikilink in a heading as a link inline", () => {
    const [h] = parseMarkdown("## About [[Rexxentrum]]");
    expect(h.inlines?.[1].link).toEqual({ target: "Rexxentrum", kind: "wikilink" });
  });

  it("turns an embed inside a heading into a link inline rather than a block", () => {
    const blocks = parseMarkdown("## ![[Cave.png]]");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].inlines?.[0].link?.target).toBe("Cave.png");
  });

  it("drops Obsidian <!-- Column N --> layout comments", () => {
    const blocks = parseMarkdown("<!-- Column 1 -->\n\nLeft text.\n\n<!-- Column 2 -->\n\nRight text.");
    expect(blocks.map((b) => [b.type, textOf(b)])).toEqual([
      ["paragraph", "Left text."],
      ["paragraph", "Right text."],
    ]);
  });

  it("drops an HTML comment sitting inside a paragraph without leaking its text", () => {
    const [p] = parseMarkdown("Before <!-- Column 2 --> after.");
    expect(textOf(p)).not.toContain("Column");
    expect(textOf(p).replace(/\s+/g, " ")).toBe("Before after.");
  });

  it("maps other block HTML to an unsupported block", () => {
    expect(parseMarkdown("<div class=\"x\">raw</div>")[0].type).toBe("unsupported");
  });

  it("keeps a fenced code block's text as a code inline", () => {
    const [b] = parseMarkdown("```\nline one\nline two\n```");
    expect(b.type).toBe("paragraph");
    expect(b.inlines).toEqual([{ text: "line one\nline two", code: true }]);
  });

  it("returns an empty array for an empty body", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });

  it("gives every block a stable id across two parses of the same input", () => {
    const md = [
      "# Title",
      "> [!dm]- Secret\n> Hidden.\n>\n> - one\n> - two",
      "![[Related.base#NPCs here]]\n![[Art.png]]",
      "- a\n  - b",
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    ].join("\n\n");
    const ids = (blocks: MdBlock[]): string[] => blocks.flatMap((b) => [b.id, ...ids(b.children ?? [])]);
    const first = ids(parseMarkdown(md));
    expect(first.length).toBeGreaterThan(8);
    expect(ids(parseMarkdown(md))).toEqual(first);
    expect(parseMarkdown(md)).toEqual(parseMarkdown(md));
  });

  it("gives every block an id that is unique within the document", () => {
    const md = "# T\n\n> [!tip] x\n> a\n>\n> b\n\n- one\n  - two\n- three\n\n![[A.png]]\n![[B.png]]";
    const all = (blocks: MdBlock[]): string[] => blocks.flatMap((b) => [b.id, ...all(b.children ?? [])]);
    const ids = all(parseMarkdown(md));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not let an unrelated earlier document change a block's id", () => {
    parseMarkdown("# a\n\nb\n\nc\n\nd");
    expect(parseMarkdown("# Title\n\nBody.").map((b) => b.id)).toEqual(["0", "1"]);
  });
});
