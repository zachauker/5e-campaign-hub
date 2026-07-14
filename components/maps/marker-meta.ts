import {
  MapPin, Flag, UserRound, Layers, StickyNote,
  Swords, MessagesSquare, Drama, ScrollText, type LucideIcon,
} from "lucide-react";
import type { MarkerType, ResolvedMarker } from "@/components/maps/map-types";

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
  event: { label: "Event", color: "var(--marker-event)", icon: ScrollText },
};

// Display order for pickers.
export const MARKER_TYPES: MarkerType[] = ["location", "faction", "character", "submap", "note", "event"];

// Per-Notion-"Type" visuals for event markers. Keys match the Session Timeline
// "Type" select. Falls back to the generic event visual for unknown values.
const EVENT_TYPE_META: Record<string, MarkerTypeMeta> = {
  "Combat Encounter": { label: "Combat Encounter", color: "var(--marker-event)", icon: Swords },
  "RP Encounter": { label: "RP Encounter", color: "var(--marker-event)", icon: MessagesSquare },
  "Character Event": { label: "Character Event", color: "var(--marker-event)", icon: Drama },
  "Story Outline": { label: "Story Outline", color: "var(--marker-event)", icon: ScrollText },
  "Session Notes": { label: "Session Notes", color: "var(--marker-event)", icon: ScrollText },
};

// Core resolver: the icon+color+label for a marker type and optional subtype.
// Event markers vary by the note's Notion Type; every other type uses
// MARKER_TYPE_META unchanged. Pure — safe under renderToStaticMarkup.
export function visualForType(type: MarkerType, subtype?: string | null): MarkerTypeMeta {
  if (type === "event") {
    return (subtype && EVENT_TYPE_META[subtype]) || MARKER_TYPE_META.event;
  }
  return MARKER_TYPE_META[type];
}

// Convenience wrapper for callers holding a full ResolvedMarker.
export function markerVisual(marker: ResolvedMarker): MarkerTypeMeta {
  return visualForType(marker.type, marker.entitySubtype);
}
