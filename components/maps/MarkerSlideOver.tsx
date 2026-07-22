// components/maps/MarkerSlideOver.tsx
"use client";

import Link from "next/link";
import { X, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { markerVisual } from "@/components/maps/marker-meta";
import { entityTargetOf } from "@/components/maps/marker-slideover-target";
import { EntityQuickViewBody } from "@/components/entities/EntityQuickView";
import { EventNoteBody } from "@/components/maps/EventNoteBody";
import { resolveMarkerAppearance } from "@/components/maps/marker-appearance";
import type { TypeAppearanceMap } from "@/components/maps/marker-appearance";
import type { ResolvedMarker } from "@/components/maps/map-types";

interface MarkerSlideOverProps {
  marker: ResolvedMarker;
  onClose: () => void;
  onEditPin: () => void;
  onDeletePin: () => void;
  typeDefaults?: TypeAppearanceMap;
}

/**
 * The unified left-docked quick-view slide-over shown when a map marker is
 * selected. One shell for every pin type: marker header, a per-type body, and a
 * single footer (Open link + Edit pin + Delete pin). Used by both map viewers.
 */
export function MarkerSlideOver({ marker, onClose, onEditPin, onDeletePin, typeDefaults }: MarkerSlideOverProps) {
  // The header's icon/color must reflect the resolved (possibly customized)
  // appearance — the same one rendered on the map — not just the type's
  // built-in default. The label text still comes from the type meta, since
  // the resolver doesn't produce one.
  const appearance = resolveMarkerAppearance(marker, typeDefaults ?? {});
  const label = markerVisual(marker).label;
  const Icon = appearance.icon;
  const target = entityTargetOf(marker);

  let openLink: { href: string; label: string } | null = null;
  if (target) {
    openLink = { href: `/${target.resourcePath}/${target.id}`, label: "Open page" };
  } else if (marker.type === "event" && marker.entityId) {
    openLink = { href: `/sessions/${marker.entityId}`, label: "Open page" };
  } else if (marker.type === "submap" && marker.targetMapId) {
    openLink = { href: `/maps/${marker.targetMapId}`, label: "Open sub-map" };
  }

  return (
    <div className="panel-in absolute top-4 left-4 bottom-4 w-96 max-w-[calc(100%-2rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl z-[1000]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3.5 border-b border-border flex-none">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className="w-4 h-4 mt-1 flex-none" style={{ color: appearance.color }} aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight">{marker.resolvedTitle}</div>
            <div className="mt-0.5 text-xs font-medium" style={{ color: appearance.color }}>{label}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex-none text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body (per type) */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {marker.resolvedSubtitle && <p className="text-xs text-destructive mb-2">{marker.resolvedSubtitle}</p>}

        {target && <EntityQuickViewBody resourcePath={target.resourcePath} id={target.id} />}

        {marker.type === "event" && <EventNoteBody marker={marker} />}

        {marker.type === "note" &&
          (marker.note ? (
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{marker.note}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No note text.</p>
          ))}

        {marker.type === "submap" && <p className="text-sm text-muted-foreground">Links to another map.</p>}
      </div>

      {/* Footer (Option A: single row) */}
      <div className="flex items-center gap-3 border-t border-border p-3 text-xs flex-none">
        {openLink && (
          <Link href={openLink.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {openLink.label} <ArrowUpRight className="w-3 h-3" />
          </Link>
        )}
        <button onClick={onEditPin} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3 h-3" /> Edit pin
        </button>
        <button onClick={onDeletePin} className="ml-auto inline-flex items-center gap-1 text-destructive hover:underline">
          <Trash2 className="w-3 h-3" /> Delete pin
        </button>
      </div>
    </div>
  );
}
