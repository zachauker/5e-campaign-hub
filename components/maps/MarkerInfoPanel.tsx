"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { MARKER_TYPE_META } from "@/components/maps/marker-meta";
import type { ResolvedMarker } from "@/components/maps/map-types";

const ENTITY_PATH: Partial<Record<ResolvedMarker["type"], string>> = {
  character: "characters",
  location: "locations",
  faction: "factions",
};

interface MarkerInfoPanelProps {
  marker: ResolvedMarker;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * The quick-info card shown when a map marker is selected. Reads as a gazetteer
 * entry: serif name, the type in its own marker colour, and a footer of actions.
 * Shared by the world map and the local map viewers.
 */
export function MarkerInfoPanel({ marker, onClose, onEdit, onDelete }: MarkerInfoPanelProps) {
  const meta = MARKER_TYPE_META[marker.type];
  const Icon = meta.icon;
  const entityPath = ENTITY_PATH[marker.type];

  return (
    <div className="panel-in absolute top-4 left-4 w-64 rounded-xl border border-border bg-card p-3.5 shadow-2xl z-[1000]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className="w-4 h-4 mt-1 flex-none" style={{ color: meta.color }} aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight truncate">{marker.resolvedTitle}</div>
            <div className="mt-0.5 text-xs font-medium" style={{ color: meta.color }}>
              {meta.label}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex-none text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {marker.type === "note" && marker.note && (
        <p className="mt-2.5 text-sm text-muted-foreground leading-relaxed">{marker.note}</p>
      )}
      {marker.resolvedSubtitle && (
        <p className="mt-1.5 text-xs text-destructive">{marker.resolvedSubtitle}</p>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5 text-xs">
        {entityPath && marker.entityId && (
          <Link
            href={`/${entityPath}/${marker.entityId}`}
            className="font-medium text-primary hover:underline"
          >
            View {meta.label.toLowerCase()} →
          </Link>
        )}
        <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition-colors">
          Edit
        </button>
        <button onClick={onDelete} className="ml-auto text-destructive hover:underline">
          Delete
        </button>
      </div>
    </div>
  );
}
