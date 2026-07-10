import { describe, it, expect } from "vitest";
import { mapFactionRow, mapCharacterRow, mapItemRow } from "./map";

const page = (id: string, properties: Record<string, unknown>) => ({
  id,
  url: `https://www.notion.so/${id.replace(/-/g, "")}`,
  properties,
});

describe("mapFactionRow", () => {
  it("maps name, active→archived, and props", () => {
    const m = mapFactionRow(page("9380408e-eb15-46c3-8a5c-4b3eef73da60", {
      Name: { type: "title", title: [{ plain_text: "Children of Malice" }] },
      Active: { type: "checkbox", checkbox: true },
      Type: { type: "select", select: { name: "Criminal" } },
      "Alignment Toward Party": { type: "select", select: { name: "Opposed" } },
    }));
    expect(m.name).toBe("Children of Malice");
    expect(m.archived).toBe(false);
    expect(m.notionPageId).toBe("9380408eeb1546c38a5c4b3eef73da60");
    expect(m.notionProps).toEqual([
      { label: "Type", value: "Criminal" },
      { label: "Alignment", value: "Opposed" },
    ]);
  });
  it("archives when Active is false", () => {
    const m = mapFactionRow(page("f1", {
      Name: { type: "title", title: [{ plain_text: "Defunct" }] },
      Active: { type: "checkbox", checkbox: false },
    }));
    expect(m.archived).toBe(true);
    expect(m.notionProps).toEqual([]);
  });
});

describe("mapCharacterRow", () => {
  it("maps type, ddb id, affiliations, and props", () => {
    const m = mapCharacterRow(page("c1", {
      Name: { type: "title", title: [{ plain_text: "Shale" }] },
      Type: { type: "select", select: { name: "Player" } },
      "Character Sheet": { type: "url", url: "https://www.dndbeyond.com/characters/145821922" },
      Affiliations: { type: "multi_select", multi_select: [{ name: "Children of Malice" }] },
      Active: { type: "checkbox", checkbox: true },
      Race: { type: "select", select: { name: "Dragonborne" } },
      Class: { type: "multi_select", multi_select: [{ name: "Rogue" }] },
      "Character Level": { type: "number", number: 4 },
      "Disposition Toward Party": { type: "select", select: { name: "Friendly" } },
      "Role/Title": { type: "rich_text", rich_text: [{ plain_text: "Party Rogue" }] },
    }));
    expect(m.extra).toEqual({ type: "pc", ddbCharacterId: "145821922" });
    expect(m.affiliations).toEqual(["Children of Malice"]);
    expect(m.notionProps).toEqual([
      { label: "Race", value: "Dragonborne" },
      { label: "Class", value: "Rogue" },
      { label: "Level", value: "4" },
      { label: "Disposition", value: "Friendly" },
      { label: "Role/Title", value: "Party Rogue" },
    ]);
  });
  it("keeps a non-ddb sheet url in props and leaves ddb id null", () => {
    const m = mapCharacterRow(page("c2", {
      Name: { type: "title", title: [{ plain_text: "NPC" }] },
      Type: { type: "select", select: { name: "NPC" } },
      "Character Sheet": { type: "url", url: "https://example.com/sheet" },
    }));
    expect(m.extra).toEqual({ type: "npc", ddbCharacterId: null });
    expect(m.notionProps).toContainEqual({ label: "Character Sheet", value: "https://example.com/sheet" });
  });
});

describe("mapItemRow", () => {
  it("maps description (synced), held-by ids, and props", () => {
    const m = mapItemRow(page("i1", {
      Name: { type: "title", title: [{ plain_text: "Fragment of Caedrus" }] },
      Description: { type: "rich_text", rich_text: [{ plain_text: "A shard of a divine artifact." }] },
      Type: { type: "select", select: { name: "Quest Item" } },
      Rarity: { type: "select", select: { name: "Artifact" } },
      "Held By": { type: "relation", relation: [{ id: "213e996b-e66d-80d6-a7cd-f142c199b757" }] },
    }));
    expect(m.extra).toEqual({ description: "A shard of a divine artifact." });
    expect(m.heldByPageIds).toEqual(["213e996be66d80d6a7cdf142c199b757"]);
    expect(m.notionProps).toEqual([
      { label: "Type", value: "Quest Item" },
      { label: "Rarity", value: "Artifact" },
    ]);
  });
});
