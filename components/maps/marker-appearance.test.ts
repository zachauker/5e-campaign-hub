// components/maps/marker-appearance.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveMarkerAppearance,
  resolveIcon,
  SIZE_SCALE,
  type TypeAppearanceMap,
  type MarkerAppearanceInput,
} from "./marker-appearance";

function marker(over: Partial<MarkerAppearanceInput> = {}): MarkerAppearanceInput {
  return { type: "location", entitySubtype: null, size: null, shape: null, icon: null, labelSize: null, color: null, ...over };
}

describe("resolveMarkerAppearance", () => {
  it("uses built-in type defaults when nothing is overridden", () => {
    const a = resolveMarkerAppearance(marker(), {});
    expect(a.shape).toBe("teardrop");
    expect(a.anchor).toBe("bottom");
    expect(a.color).toBe("var(--marker-location)");
    expect(a.labelSize).toBe("md");
    expect(a.labelHidden).toBe(false);
    expect(a.width).toBe(28);
    expect(a.height).toBe(36);
    // lucide-react ^1.16.0 exports icons as React.forwardRef objects, not
    // plain functions, so assert identity/truthiness rather than typeof.
    expect(a.icon).toBeTruthy();
  });

  it("applies a per-type default", () => {
    const defaults: TypeAppearanceMap = { location: { size: "lg", shape: "square", color: "#ff0000" } };
    const a = resolveMarkerAppearance(marker(), defaults);
    expect(a.shape).toBe("square");
    expect(a.anchor).toBe("center");
    expect(a.color).toBe("#ff0000");
    expect(a.width).toBe(Math.round(30 * SIZE_SCALE.lg));
  });

  it("per-pin override beats the per-type default beats built-in", () => {
    const defaults: TypeAppearanceMap = { location: { size: "lg", color: "#ff0000" } };
    const a = resolveMarkerAppearance(marker({ size: "sm", color: "#00ff00" }), defaults);
    expect(a.color).toBe("#00ff00");
    expect(a.width).toBe(Math.round(28 * SIZE_SCALE.sm));
  });

  it("resolves a named icon override, falling back to the type icon on unknown names", () => {
    const known = resolveMarkerAppearance(marker({ icon: "Castle" }), {});
    expect(known.icon).toBe(resolveIcon("Castle"));
    const unknown = resolveMarkerAppearance(marker({ icon: "NotARealIcon" }), {});
    expect(unknown.icon).toBe(resolveMarkerAppearance(marker(), {}).icon);
  });

  it("labelSize 'hide' sets labelHidden and keeps a concrete size for text", () => {
    const a = resolveMarkerAppearance(marker({ labelSize: "hide" }), {});
    expect(a.labelHidden).toBe(true);
    expect(["sm", "md", "lg"]).toContain(a.labelSize);
  });

  it("resolveIcon returns null for an unknown name", () => {
    expect(resolveIcon("Nope___")).toBeNull();
  });
});
