import { describe, it, expect } from "vitest";
import { layerKeyOf, deriveLayerGroups } from "./marker-layers";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: Math.random().toString(), mapId: "map", x: 0, y: 0, type: "note", entityId: null,
  targetMapId: null, title: null, note: null, minZoom: null,
  size: null, shape: null, icon: null, labelSize: null, color: null,
  resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("event layers", () => {
  it("keys an event marker on its Notion Type", () => {
    expect(layerKeyOf(marker({ type: "event", entitySubtype: "Combat Encounter" }))).toBe("event:Combat Encounter");
    expect(layerKeyOf(marker({ type: "event", entitySubtype: null }))).toBe("event:other");
  });

  it("groups events with per-Type leaves and counts", () => {
    const groups = deriveLayerGroups([
      marker({ type: "event", entitySubtype: "Combat Encounter" }),
      marker({ type: "event", entitySubtype: "RP Encounter" }),
      marker({ type: "event", entitySubtype: "Combat Encounter" }),
    ]);
    const events = groups.find((g) => g.key === "event")!;
    expect(events.count).toBe(3);
    expect(events.leaves.find((l) => l.key === "event:Combat Encounter")!.count).toBe(2);
  });
});
