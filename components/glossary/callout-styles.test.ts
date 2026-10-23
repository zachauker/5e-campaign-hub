import { describe, it, expect } from "vitest";
import { DEFAULT_CALLOUT_STYLE, KNOWN_CALLOUT_TYPES, calloutLabel, calloutStyle } from "./callout-styles";

/** The vault style guide's types, by group. */
const VAULT_TYPES = [
  "read-aloud", "abstract",
  "dm",
  "npc", "location", "describe",
  "combat", "social", "check", "rules", "statblock", "minis",
  "lore", "vision", "hook", "map",
  "todo", "decision", "goal", "dependency", "flow", "spotlight", "owed",
  "info", "note", "tip", "warning", "success",
];

describe("calloutStyle", () => {
  it.each(VAULT_TYPES)("has a dedicated look for [!%s]", (type) => {
    expect(KNOWN_CALLOUT_TYPES).toContain(type);
    const s = calloutStyle(type);
    expect(s.icon).toBeDefined();
    expect(s.box).toMatch(/border-/);
  });

  it("gives an unknown type the default look rather than nothing", () => {
    expect(calloutStyle("brand-new-type")).toBe(DEFAULT_CALLOUT_STYLE);
    expect(calloutStyle(undefined)).toBe(DEFAULT_CALLOUT_STYLE);
    expect(calloutStyle("")).toBe(DEFAULT_CALLOUT_STYLE);
  });

  it("does not resolve a prototype key to a style", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(calloutStyle(key)).toBe(DEFAULT_CALLOUT_STYLE);
    }
  });

  it("is case-insensitive", () => {
    expect(calloutStyle("DM")).toBe(calloutStyle("dm"));
  });

  it("marks DM-only content apart from player-facing text", () => {
    expect(calloutStyle("dm").accent).not.toBe(calloutStyle("read-aloud").accent);
    expect(calloutStyle("dm").icon).not.toBe(calloutStyle("read-aloud").icon);
  });
});

describe("calloutLabel", () => {
  it("humanises a type with no title", () => {
    expect(calloutLabel("read-aloud")).toBe("Read aloud");
    expect(calloutLabel("statblock")).toBe("Statblock");
    expect(calloutLabel("brand-new_type")).toBe("Brand new type");
  });

  it("spells acronyms the way the DM writes them", () => {
    expect(calloutLabel("dm")).toBe("DM");
    expect(calloutLabel("npc")).toBe("NPC");
  });

  it("falls back to Note", () => {
    expect(calloutLabel(undefined)).toBe("Note");
    expect(calloutLabel("")).toBe("Note");
  });

  it("does not resolve a prototype key", () => {
    expect(calloutLabel("constructor")).toBe("Constructor");
  });
});
