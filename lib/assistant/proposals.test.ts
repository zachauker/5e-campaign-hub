import { describe, it, expect } from "vitest";
import { buildEncounterProposal, buildEntityProposal, buildMarkerProposal, buildNotionSyncProposal, assertHubAuthored } from "./proposals";

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
