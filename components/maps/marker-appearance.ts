// components/maps/marker-appearance.ts
import {
  MapPin, Castle, Mountain, MountainSnow, Trees, TreePine, Skull, Crown, Swords, Shield,
  House, Church, Anchor, Ship, Tent, Flag, Gem, Coins, Landmark, Waves, Flame, Snowflake,
  Eye, Star, Compass, Key, ScrollText, Footprints, Sparkles, Zap, type LucideIcon,
} from "lucide-react";
import type { MarkerType } from "@/components/maps/map-types";
import { visualForType } from "@/components/maps/marker-meta";

export type MarkerSize = "sm" | "md" | "lg" | "xl";
export type MarkerShape = "teardrop" | "circle" | "square" | "diamond";
export type MarkerLabelSize = "sm" | "md" | "lg" | "hide";

/** Typed override — used by the editor and the per-type settings map. */
export interface MarkerAppearanceOverride {
  size?: MarkerSize | null;
  shape?: MarkerShape | null;
  icon?: string | null;
  labelSize?: MarkerLabelSize | null;
  color?: string | null;
}

/** The marker fields the resolver reads. Loose (string) because they come straight
 *  from DB TEXT columns (a ResolvedMarker satisfies this); the resolver validates. */
export interface MarkerAppearanceInput {
  type: MarkerType;
  entitySubtype?: string | null;
  size?: string | null;
  shape?: string | null;
  icon?: string | null;
  labelSize?: string | null;
  color?: string | null;
}

export type TypeAppearanceMap = Partial<Record<MarkerType, MarkerAppearanceOverride>>;

export interface ResolvedAppearance {
  width: number;
  height: number;
  iconSize: number;
  shape: MarkerShape;
  color: string;
  icon: LucideIcon;
  iconName: string;
  anchor: "bottom" | "center";
  labelSize: "sm" | "md" | "lg";
  labelHidden: boolean;
}

export const SIZE_SCALE: Record<MarkerSize, number> = { sm: 0.72, md: 1, lg: 1.4, xl: 1.85 };
export const SIZES: MarkerSize[] = ["sm", "md", "lg", "xl"];
export const SHAPES: MarkerShape[] = ["teardrop", "circle", "square", "diamond"];
export const LABEL_SIZES: MarkerLabelSize[] = ["sm", "md", "lg", "hide"];
export const LABEL_TEXT_PX: Record<"sm" | "md" | "lg", string> = { sm: "9px", md: "10px", lg: "13px" };

/** Curated fantasy/map icon set (name → component). Bounded, explicit imports. */
export const ICON_SET: Record<string, LucideIcon> = {
  MapPin, Castle, Mountain, MountainSnow, Trees, TreePine, Skull, Crown, Swords, Shield,
  House, Church, Anchor, Ship, Tent, Flag, Gem, Coins, Landmark, Waves, Flame, Snowflake,
  Eye, Star, Compass, Key, ScrollText, Footprints, Sparkles, Zap,
};
export const ICON_NAMES: string[] = Object.keys(ICON_SET);

export const COLOR_OPTIONS: { label: string; value: string }[] = [
  { label: "Location", value: "var(--marker-location)" },
  { label: "Faction", value: "var(--marker-faction)" },
  { label: "Character", value: "var(--marker-character)" },
  { label: "Item", value: "var(--marker-item)" },
  { label: "Event", value: "var(--marker-event)" },
  { label: "Red", value: "#c0504d" },
  { label: "Green", value: "#4fae8f" },
  { label: "Blue", value: "#5a8fd0" },
  { label: "Purple", value: "#7c6fd0" },
  { label: "Gold", value: "#e0b050" },
  { label: "Slate", value: "#8a8f98" },
];

export function resolveIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return ICON_SET[name] ?? null;
}

const SIZE_SET = new Set<string>(SIZES);
const SHAPE_SET = new Set<string>(SHAPES);
const LABEL_SET = new Set<string>(LABEL_SIZES);

function firstValid<T extends string>(set: Set<string>, ...vals: (string | null | undefined)[]): T | undefined {
  for (const v of vals) if (v != null && set.has(v)) return v as T;
  return undefined;
}
function firstNonNull(...vals: (string | null | undefined)[]): string | undefined {
  for (const v of vals) if (v != null) return v;
  return undefined;
}

export function resolveMarkerAppearance(
  marker: MarkerAppearanceInput,
  typeDefaults: TypeAppearanceMap,
): ResolvedAppearance {
  const base = visualForType(marker.type, marker.entitySubtype);
  const td = typeDefaults[marker.type] ?? {};

  const size = firstValid<MarkerSize>(SIZE_SET, marker.size, td.size, "md")!;
  const shape = firstValid<MarkerShape>(SHAPE_SET, marker.shape, td.shape, "teardrop")!;
  const labelRaw = firstValid<MarkerLabelSize>(LABEL_SET, marker.labelSize, td.labelSize, "md")!;
  const color = firstNonNull(marker.color, td.color, base.color)!;
  const wantedIcon = firstNonNull(marker.icon, td.icon);
  const resolvedIcon = resolveIcon(wantedIcon);
  const icon = resolvedIcon ?? base.icon;
  // Stable identity of the effective icon, for re-render signatures (world canvas).
  const iconName = resolvedIcon ? wantedIcon! : "@default";

  const scale = SIZE_SCALE[size];
  const teardrop = shape === "teardrop";
  const width = teardrop ? Math.round(28 * scale) : Math.round(30 * scale);
  const height = teardrop ? Math.round(36 * scale) : Math.round(30 * scale);
  const iconSize = Math.round(14 * scale);

  return {
    width,
    height,
    iconSize,
    shape,
    color,
    icon,
    iconName,
    anchor: teardrop ? "bottom" : "center",
    labelSize: labelRaw === "hide" ? "md" : labelRaw,
    labelHidden: labelRaw === "hide",
  };
}
