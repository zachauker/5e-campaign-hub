import { describe, it, expect } from "vitest";
import { blocksToPlainText, hashContent } from "./content-hash";
import type { NotionBlockData } from "@/lib/notion/client";

const block = (type: string, text: string): NotionBlockData => ({
  id: `${type}-${text.slice(0, 4)}`,
  type,
  richText: [{ text }],
});

describe("blocksToPlainText", () => {
  it("joins block text with newlines", () => {
    const out = blocksToPlainText([block("heading_1", "The Pentamarket"), block("paragraph", "Ovid ran.")]);
    expect(out).toBe("The Pentamarket\nOvid ran.");
  });

  it("concatenates rich-text runs within one block", () => {
    const out = blocksToPlainText([{ id: "b", type: "paragraph", richText: [{ text: "He " }, { text: "admitted it." }] }]);
    expect(out).toBe("He admitted it.");
  });

  it("skips blocks with no text", () => {
    const out = blocksToPlainText([block("paragraph", "kept"), { id: "d", type: "divider" }, { id: "i", type: "image", imageUrl: "x" }]);
    expect(out).toBe("kept");
  });

  it("returns an empty string for no blocks", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("hashContent", () => {
  it("is stable for identical text", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });
  it("differs for different text", () => {
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
  it("ignores leading and trailing whitespace differences", () => {
    expect(hashContent("  abc\n")).toBe(hashContent("abc"));
  });
  it("returns a hex digest", () => {
    expect(hashContent("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
