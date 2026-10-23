import { describe, it, expect } from "vitest";
import { buildEntityQuickView, PROP_LIMIT } from "./entity-quick-view-model";

describe("buildEntityQuickView", () => {
  it("maps a fully-populated location", () => {
    const m = buildEntityQuickView("locations", {
      id: "loc1",
      name: "Emon",
      description: "Capital of Tal'Dorei.",
      type: "city",
      sourceProps: [{ label: "Region", value: "Tal'Dorei" }],
      linkedCharacters: [{ id: "c1", name: "Vex", type: "pc" }],
    });
    expect(m.name).toBe("Emon");
    expect(m.typeLabel).toBe("City");
    expect(m.description).toBe("Capital of Tal'Dorei.");
    expect(m.props).toEqual([{ label: "Region", value: "Tal'Dorei" }]);
    expect(m.fullHref).toBe("/locations/loc1");
    expect(m.related).toEqual([
      { label: "Characters", items: [{ id: "c1", name: "Vex", href: "/characters/c1", type: "PC" }] },
    ]);
  });

  it("omits empty sections for a bare faction", () => {
    const m = buildEntityQuickView("factions", { id: "f1", name: "Clasp", description: null });
    expect(m.typeLabel).toBeNull();
    expect(m.description).toBeNull();
    expect(m.props).toEqual([]);
    expect(m.related).toEqual([]);
  });

  it("labels character pc/npc and groups character relations", () => {
    const m = buildEntityQuickView("characters", {
      id: "c1",
      name: "Vex",
      type: "npc",
      relatedFactions: [{ id: "f1", name: "Vox Machina" }],
      relatedLocations: [],
      relatedItems: [{ id: "i1", name: "Fenthras" }],
    });
    expect(m.typeLabel).toBe("NPC");
    expect(m.related).toEqual([
      { label: "Factions", items: [{ id: "f1", name: "Vox Machina", href: "/factions/f1" }] },
      { label: "Items", items: [{ id: "i1", name: "Fenthras", href: "/items/i1" }] },
    ]);
  });

  it("caps props at PROP_LIMIT", () => {
    const props = Array.from({ length: PROP_LIMIT + 3 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const m = buildEntityQuickView("items", { id: "i1", name: "Cloak", sourceProps: props });
    expect(m.props).toHaveLength(PROP_LIMIT);
    expect(m.props[0]).toEqual({ label: "L0", value: "V0" });
  });

  it("passes an unknown location type through verbatim as its own label", () => {
    const m = buildEntityQuickView("locations", { id: "l9", name: "?", type: "plane" });
    expect(m.typeLabel).toBe("plane");
  });

  it("treats an unknown character type as no label / undefined related type", () => {
    const m = buildEntityQuickView("characters", { id: "c9", name: "??", type: "monster" });
    expect(m.typeLabel).toBeNull();
    const linked = buildEntityQuickView("locations", {
      id: "l1", name: "X",
      linkedCharacters: [{ id: "c9", name: "??", type: "monster" }],
    });
    expect(linked.related[0].items[0].type).toBeUndefined();
  });
});
