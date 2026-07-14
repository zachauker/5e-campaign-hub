"use client";

import { cn } from "@/lib/utils";
import type { MapMarker } from "@/lib/db/schema";
import { visualForType } from "@/components/maps/marker-meta";

export function MapMarkerPin({
  type, subtype, selected,
}: { type: MapMarker["type"]; subtype?: string | null; selected?: boolean }) {
  const meta = visualForType(type, subtype);
  const Icon = meta.icon;
  return (
    <div className={cn("relative", selected && "marker-selected marker-bloom")}>
      <svg width="28" height="36" viewBox="0 0 28 36" className="drop-shadow-md">
        <path
          d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22c0-7.7-6.3-14-14-14z"
          fill={meta.color}
        />
        <circle cx="14" cy="14" r="9" fill="var(--card)" />
      </svg>
      <Icon
        className="absolute w-3.5 h-3.5"
        style={{ color: meta.color, top: "8px", left: "50%", transform: "translateX(-50%)" }}
      />
    </div>
  );
}
