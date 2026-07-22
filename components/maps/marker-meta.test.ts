import { describe, it, expect } from "vitest";
import { Swords, StickyNote } from "lucide-react";
import { markerVisual } from "./marker-meta";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: "m", mapId: "map", x: 0, y: 0, type: "note", entityId: null, targetMapId: null,
  title: null, note: null, minZoom: null,
  size: null, shape: null, icon: null, labelSize: null, color: null,
  resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("markerVisual", () => {
  it("uses the Notion Type for an event marker", () => {
    const v = markerVisual(marker({ type: "event", entitySubtype: "Combat Encounter" }));
    expect(v.icon).toBe(Swords);
    expect(v.label).toBe("Combat Encounter");
  });

  it("falls back to a generic event visual for an unknown Type", () => {
    const v = markerVisual(marker({ type: "event", entitySubtype: null }));
    expect(v.label).toBe("Event");
  });

  it("falls back to MARKER_TYPE_META for non-event markers", () => {
    const v = markerVisual(marker({ type: "note" }));
    expect(v.icon).toBe(StickyNote);
    expect(v.label).toBe("Note");
  });
});
