import { describe, it, expect } from "vitest";
import { SESSION_NOTE_TYPE_ORDER } from "./session-note-types";

describe("SESSION_NOTE_TYPE_ORDER", () => {
  it("lists every note type the vault can produce, so none falls into Uncategorized", () => {
    for (const type of [
      "Story Outline",
      "Session Notes",
      "Character Event",
      "Combat Encounter",
      "RP Encounter",
      "Exploration Encounter",
    ]) {
      expect(SESSION_NOTE_TYPE_ORDER).toContain(type);
    }
  });

  it("groups the encounter types together, after the narrative types", () => {
    const i = (t: string) => SESSION_NOTE_TYPE_ORDER.indexOf(t);
    expect(i("Exploration Encounter")).toBe(i("RP Encounter") + 1);
  });
});
