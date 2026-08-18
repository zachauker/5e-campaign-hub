import { describe, it, expect } from "vitest";
import {
  buildEncounterProposal,
  buildEntityProposal,
  buildMarkerProposal,
  buildNotionSyncProposal,
  assertHubAuthored,
  HUB_AUTHORED,
  assertCitation,
  normalizeForCitation,
  buildThreadOpenProposal,
  buildThreadResolveProposal,
  buildClockTickProposal,
  buildDateAdvanceProposal,
} from "./proposals";

describe("assertHubAuthored", () => {
  it("rejects Notion-synced fields", () => {
    expect(() => assertHubAuthored("location", { name: "X", type: "city" })).toThrow(/not hub-authored: type/);
    expect(() => assertHubAuthored("item", { description: "shiny" })).toThrow(/not hub-authored: description/);
  });
  it("allows hub-authored fields", () => {
    expect(() => assertHubAuthored("character", { name: "Sela", description: "a spy" })).not.toThrow();
  });
});

describe("buildEncounterProposal", () => {
  it("targets the encounters route with combatants", () => {
    const p = buildEncounterProposal("camp1", { name: "Ashkeep Ambush", combatants: [{ name: "Goblin", type: "monster", hpMax: 7, ac: 15 }] });
    expect(p).toMatchObject({ targetRoute: "/api/encounters", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", name: "Ashkeep Ambush" });
    expect(p.payload.combatants).toHaveLength(1);
    expect(p.summary).toContain("Ashkeep Ambush");
  });
});

describe("buildEntityProposal", () => {
  it("create -> POST /api/{kind}s with campaignId", () => {
    const p = buildEntityProposal("camp1", { kind: "character", fields: { name: "Sela Vord", description: "Concord spy" } });
    expect(p).toMatchObject({ targetRoute: "/api/characters", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", name: "Sela Vord" });
  });
  it("update -> PATCH /api/{kind}s/{id}", () => {
    const p = buildEntityProposal("camp1", { kind: "faction", id: "f1", fields: { description: "updated" } });
    expect(p).toMatchObject({ targetRoute: "/api/factions/f1", method: "PATCH" });
  });
  it("throws when fields include a synced column", () => {
    expect(() => buildEntityProposal("camp1", { kind: "location", fields: { name: "X", type: "poi" } })).toThrow(/not hub-authored/);
    expect(() => buildEntityProposal("camp1", { kind: "character", fields: { type: "pc" } })).toThrow(/not hub-authored/);
  });
});

describe("HUB_AUTHORED allowlist", () => {
  it("never exposes sync-managed columns", () => {
    expect(HUB_AUTHORED.character).not.toEqual(expect.arrayContaining(["type", "ddbCharacterId", "notionProps", "archived"]));
    expect(HUB_AUTHORED.location).not.toContain("type");
    expect(HUB_AUTHORED.item).not.toContain("description");
    for (const kind of ["character", "location", "item", "faction"] as const) {
      expect(HUB_AUTHORED[kind]).not.toEqual(expect.arrayContaining(["notionProps", "notionPageId", "notionSyncedAt", "archived"]));
    }
  });
});

describe("buildMarkerProposal + buildNotionSyncProposal", () => {
  it("marker -> POST /api/maps/{mapId}/markers", () => {
    const p = buildMarkerProposal({ mapId: "m1", x: 1, y: 2, type: "location", title: "Hideout" });
    expect(p).toMatchObject({ targetRoute: "/api/maps/m1/markers", method: "POST" });
    expect(p.payload).toMatchObject({ x: 1, y: 2, type: "location" });
  });
  it("sync -> POST /api/notion/sync", () => {
    const p = buildNotionSyncProposal("camp1");
    expect(p).toMatchObject({ targetRoute: "/api/notion/sync", method: "POST", payload: { campaignId: "camp1" } });
  });
});

const NOTES = `The party cornered Ovid in the Pentamarket. He admitted the contract came
through a broker in Zadash, but died before naming them. Nine days pass on the road east.`;

describe("normalizeForCitation", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeForCitation("  He ADMITTED the contract,\n came through!  ")).toBe(
      "he admitted the contract came through",
    );
  });
});

describe("assertCitation", () => {
  it("accepts a verbatim quote", () => {
    expect(() => assertCitation("the contract came through a broker in Zadash", NOTES)).not.toThrow();
  });
  it("accepts a quote differing only in case, punctuation, and line breaks", () => {
    expect(() => assertCitation("He admitted the contract\ncame through a BROKER!", NOTES)).not.toThrow();
  });
  it("rejects a paraphrase that is not in the notes", () => {
    expect(() => assertCitation("Ovid revealed the name of his employer", NOTES)).toThrow(/not found/i);
  });
  it("rejects an empty or too-short citation", () => {
    expect(() => assertCitation("", NOTES)).toThrow(/at least/i);
    expect(() => assertCitation("Ovid died", NOTES)).toThrow(/at least/i);
  });
});

describe("buildThreadOpenProposal", () => {
  it("targets the threads route and carries the citation", () => {
    const p = buildThreadOpenProposal("camp1", {
      title: "Who is the Zadash broker?",
      stakes: "The contract holder is still hunting the party.",
      citation: "the contract came through a broker in Zadash",
      links: [{ targetKind: "location", targetId: "loc-zadash", role: "subject" }],
    }, NOTES);

    expect(p).toMatchObject({ targetRoute: "/api/threads", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", sourceKind: "proposal" });
    expect(p.payload.links).toHaveLength(1);
    expect(p.citation).toContain("broker in Zadash");
    expect(p.summary).toContain("Who is the Zadash broker?");
  });

  it("throws when the citation is not in the notes", () => {
    expect(() =>
      buildThreadOpenProposal("camp1", { title: "T", citation: "totally invented sentence here", links: [] }, NOTES),
    ).toThrow(/not found/i);
  });
});

describe("buildThreadResolveProposal", () => {
  it("PATCHes the thread to resolved", () => {
    const p = buildThreadResolveProposal(
      { threadId: "t1", threadTitle: "Find Ovid", citation: "The party cornered Ovid in the Pentamarket" },
      NOTES,
    );
    expect(p).toMatchObject({ targetRoute: "/api/threads/t1", method: "PATCH" });
    expect(p.payload).toMatchObject({ status: "resolved" });
    expect(p.summary).toContain("Find Ovid");
  });
});

describe("buildClockTickProposal", () => {
  it("sends a delta, never an absolute filled value", () => {
    const p = buildClockTickProposal(
      { clockId: "c1", clockName: "Assembly investigation", delta: 1, reason: "Ovid's death draws attention", citation: "He admitted the contract came through a broker" },
      NOTES,
    );
    expect(p).toMatchObject({ targetRoute: "/api/clocks/c1/tick", method: "POST" });
    expect(p.payload).toMatchObject({ delta: 1, sourceKind: "proposal" });
    expect(p.payload).not.toHaveProperty("filled");
    expect(p.summary).toContain("+1");
  });

  it("rejects a zero or non-integer delta", () => {
    const base = { clockId: "c1", clockName: "C", citation: "the contract came through a broker in Zadash" };
    expect(() => buildClockTickProposal({ ...base, delta: 0 }, NOTES)).toThrow(/delta/);
    expect(() => buildClockTickProposal({ ...base, delta: 1.5 }, NOTES)).toThrow(/delta/);
  });
});

describe("buildDateAdvanceProposal", () => {
  it("proposes a preview, not a blind apply", () => {
    const p = buildDateAdvanceProposal("camp1", { toDay: 276_009, days: 9, citation: "Nine days pass on the road east" }, NOTES);
    expect(p).toMatchObject({ targetRoute: "/api/campaigns/camp1/advance-date", method: "POST" });
    expect(p.payload).toEqual({ toDay: 276_009 });
    expect(p.payload).not.toHaveProperty("apply");
    expect(p.summary).toContain("9");
  });
});
