// components/maps/marker-slideover-target.ts
import type { ResolvedMarker } from "@/components/maps/map-types";

export interface EntityMarkerTarget {
  resourcePath: "characters" | "locations" | "factions";
  id: string;
}

const TYPE_TO_RESOURCE: Record<string, EntityMarkerTarget["resourcePath"]> = {
  character: "characters",
  location: "locations",
  faction: "factions",
};

/** For entity-backed pins (character/location/faction) returns the entity detail
 *  target; null for note/submap/event or when entityId is missing. */
export function entityTargetOf(marker: ResolvedMarker): EntityMarkerTarget | null {
  const resourcePath = TYPE_TO_RESOURCE[marker.type];
  if (!resourcePath || !marker.entityId) return null;
  return { resourcePath, id: marker.entityId };
}
