import { describe, it, expect } from "vitest";
import {
  readTitle, readSelect, readMultiSelect, readCheckbox,
  readNumber, readUrl, readText, readRelationIds, extractDdbId,
} from "./props";

const props = {
  Name: { type: "title", title: [{ plain_text: "Ilthara" }, { plain_text: " Duskweave" }] },
  Type: { type: "select", select: { name: "NPC" } },
  Empty: { type: "select", select: null },
  Class: { type: "multi_select", multi_select: [{ name: "Rogue" }, { name: "Wizard" }] },
  Active: { type: "checkbox", checkbox: true },
  Level: { type: "number", number: 4 },
  Sheet: { type: "url", url: "https://www.dndbeyond.com/characters/145821922" },
  Role: { type: "rich_text", rich_text: [{ plain_text: "Acquisitions Operative" }] },
  Held: { type: "relation", relation: [{ id: "213e996b-e66d-80c4-ac96-d28bdeda0d8b" }] },
} as const;

describe("property readers", () => {
  it("reads title, joining segments", () => expect(readTitle(props.Name)).toBe("Ilthara Duskweave"));
  it("reads select", () => expect(readSelect(props.Type)).toBe("NPC"));
  it("returns null for empty select", () => expect(readSelect(props.Empty)).toBeNull());
  it("reads multi_select", () => expect(readMultiSelect(props.Class)).toEqual(["Rogue", "Wizard"]));
  it("reads checkbox", () => expect(readCheckbox(props.Active)).toBe(true));
  it("reads number", () => expect(readNumber(props.Level)).toBe(4));
  it("reads url", () => expect(readUrl(props.Sheet)).toContain("dndbeyond"));
  it("reads rich_text", () => expect(readText(props.Role)).toBe("Acquisitions Operative"));
  it("reads relation ids dashless", () =>
    expect(readRelationIds(props.Held)).toEqual(["213e996be66d80c4ac96d28bdeda0d8b"]));
  it("handles missing property gracefully", () => expect(readSelect(undefined)).toBeNull());
});

describe("extractDdbId", () => {
  it("pulls the numeric id from a dndbeyond url", () =>
    expect(extractDdbId("https://www.dndbeyond.com/characters/145821922")).toBe("145821922"));
  it("returns null for non-ddb urls", () =>
    expect(extractDdbId("https://example.com/x")).toBeNull());
  it("returns null for null", () => expect(extractDdbId(null)).toBeNull());
});
