import { MapPin, Flag, UserRound, Layers, StickyNote, type LucideIcon } from "lucide-react";
import type { MarkerType } from "@/components/maps/map-types";

export interface MarkerTypeMeta {
  label: string;
  color: string;
  icon: LucideIcon;
}

// Single source of truth for a marker type's label, color, and icon — shared by
// the map pins, the marker form dialog, and the quick-info panel so they stay
// in lockstep.
export const MARKER_TYPE_META: Record<MarkerType, MarkerTypeMeta> = {
  location: { label: "Location", color: "var(--marker-location)", icon: MapPin },
  faction: { label: "Faction", color: "var(--marker-faction)", icon: Flag },
  character: { label: "Character", color: "var(--marker-character)", icon: UserRound },
  submap: { label: "Sub-map", color: "var(--marker-submap)", icon: Layers },
  note: { label: "Note", color: "var(--marker-note)", icon: StickyNote },
};

// Display order for pickers.
export const MARKER_TYPES: MarkerType[] = ["location", "faction", "character", "submap", "note"];
