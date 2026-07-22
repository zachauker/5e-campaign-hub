// components/maps/marker-slideover-target.test.ts
import { describe, it, expect } from "vitest";
import { entityTargetOf } from "./marker-slideover-target";
import type { ResolvedMarker } from "./map-types";

function marker(over: Partial<ResolvedMarker>): ResolvedMarker {
  return {
    id: "m",
    mapId: "map",
    x: 0,
    y: 0,
    type: "note",
    entityId: null,
    targetMapId: null,
    title: null,
    note: null,
    minZoom: null,
    resolvedTitle: "",
    resolvedSubtitle: null,
    ...over,
  } as ResolvedMarker;
}

describe("entityTargetOf", () => {
  it("maps character/location/faction to resourcePath + id", () => {
    expect(entityTargetOf(marker({ type: "character", entityId: "c1" }))).toEqual({ resourcePath: "characters", id: "c1" });
    expect(entityTargetOf(marker({ type: "location", entityId: "l1" }))).toEqual({ resourcePath: "locations", id: "l1" });
    expect(entityTargetOf(marker({ type: "faction", entityId: "f1" }))).toEqual({ resourcePath: "factions", id: "f1" });
  });

  it("returns null for note / submap / event", () => {
    expect(entityTargetOf(marker({ type: "note" }))).toBeNull();
    expect(entityTargetOf(marker({ type: "submap", targetMapId: "m2" }))).toBeNull();
    expect(entityTargetOf(marker({ type: "event", entityId: "s1" }))).toBeNull();
  });

  it("returns null when an entity pin has no entityId", () => {
    expect(entityTargetOf(marker({ type: "character", entityId: null }))).toBeNull();
  });
});
