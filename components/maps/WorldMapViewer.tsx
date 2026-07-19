"use client";

import React, { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Loader2, Plus, X, Download, Move, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { MarkerInfoPanel } from "@/components/maps/MarkerInfoPanel";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { ResolvedMarker } from "@/components/maps/map-types";
import { MarkerLayerControl } from "@/components/maps/MarkerLayerControl";
import { isMarkerVisible, readHiddenLayers } from "@/components/maps/marker-layers";
import { readShowLabels, writeShowLabels } from "@/components/maps/marker-labels";
import { useToast } from "@/components/ui/toast";

const WorldMapCanvas = dynamic(
  () => import("@/components/maps/WorldMapCanvas").then((m) => m.WorldMapCanvas),
  { ssr: false }
);

const THEME_KEY = "worldMapTheme";

interface ThemeOption {
  id: string;
  label: string;
}

export function WorldMapViewer() {
  const { activeCampaignId } = useCampaignStore();
  const toast = useToast();
  const [worldMapId, setWorldMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === "undefined") return "classic";
    return window.localStorage.getItem(THEME_KEY) ?? "classic";
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<ResolvedMarker | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // worldMapId arrives from an async fetch, so seed the hidden set during render
  // once it's known (and whenever it changes) rather than in a set-state effect.
  const [hiddenLoadedFor, setHiddenLoadedFor] = useState<string | null>(null);
  if (worldMapId && worldMapId !== hiddenLoadedFor) {
    setHiddenLoadedFor(worldMapId);
    setHidden(readHiddenLayers(worldMapId));
  }
  const [importing, setImporting] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [lastMove, setLastMove] = useState<{ markerId: string; prevX: number; prevY: number; title: string } | null>(null);

  function updateHidden(next: Set<string>) {
    setHidden(next);
    if (worldMapId) window.localStorage.setItem(`markerLayers:${worldMapId}`, JSON.stringify([...next]));
  }

  const [showLabels, setShowLabels] = useState(false);
  const [labelsLoadedFor, setLabelsLoadedFor] = useState<string | null>(null);
  if (worldMapId && worldMapId !== labelsLoadedFor) {
    setLabelsLoadedFor(worldMapId);
    setShowLabels(readShowLabels(worldMapId));
  }

  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    if (worldMapId) writeShowLabels(worldMapId, next);
  }

  const visibleMarkers = markers.filter((m) => isMarkerVisible(m, hidden));

  const loadMarkers = useCallback(async (mapId: string) => {
    const res = await fetch(`/api/maps/${mapId}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, []);

  async function importLocations() {
    if (!activeCampaignId || !worldMapId || importing) return;
    setImporting(true);
    try {
      const res = await fetch("/api/world/import-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaignId }),
      });
      if (!res.ok) {
        toast({ title: "Import failed", description: "Please try again.", variant: "error" });
        return;
      }
      const d = (await res.json()) as { locationsCreated: number; locationsExisting: number };
      await loadMarkers(worldMapId);
      toast({
        title: `Imported ${d.locationsCreated} Exandria locations`,
        description: `${d.locationsExisting} already present.`,
        variant: "success",
      });
    } finally {
      setImporting(false);
    }
  }

  // Theme list. The persisted choice is seeded into `theme` state lazily above.
  useEffect(() => {
    fetch("/api/world/styles/themes.json")
      .then((r) => (r.ok ? r.json() : { themes: [] }))
      .then((d: { themes: ThemeOption[] }) => setThemes(d.themes));
  }, []);

  // Reset the load state during render when the campaign changes (the fetch
  // effect below then resolves it), avoiding synchronous set-state in the effect.
  const [loadingCampaign, setLoadingCampaign] = useState<string | null>(null);
  if (activeCampaignId && activeCampaignId !== loadingCampaign) {
    setLoadingCampaign(activeCampaignId);
    setLoading(true);
    setLoadError(false);
  }

  // Get-or-create the world map for the active campaign, then load markers.
  useEffect(() => {
    if (!activeCampaignId) return;
    let cancelled = false;
    fetch(`/api/world?campaignId=${activeCampaignId}`)
      .then(async (r) => {
        if (!r.ok) {
          if (!cancelled) setLoadError(true);
          return null;
        }
        return r.json();
      })
      .then(async (map: { id: string } | null) => {
        if (cancelled || !map) return;
        setWorldMapId(map.id);
        await loadMarkers(map.id);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId, loadMarkers]);

  function changeTheme(id: string) {
    setTheme(id);
    window.localStorage.setItem(THEME_KEY, id);
  }

  function handleMapClick(lngLat: { lng: number; lat: number }) {
    setPending({ x: lngLat.lng, y: lngLat.lat });
    setAddMode(false);
  }

  function persistMarkerPosition(markerId: string, x: number, y: number) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, x, y } : m)));
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
  }

  function handleMarkerDragEnd(markerId: string, lngLat: { lng: number; lat: number }) {
    // WorldMapCanvas only reports the drop (no live drag), so `markers` still
    // holds the pre-drag position here — capture it for undo before overwriting.
    const prev = markers.find((m) => m.id === markerId);
    if (prev) setLastMove({ markerId, prevX: prev.x, prevY: prev.y, title: prev.resolvedTitle });
    persistMarkerPosition(markerId, lngLat.lng, lngLat.lat);
  }

  function undoMove() {
    if (!lastMove) return;
    persistMarkerPosition(lastMove.markerId, lastMove.prevX, lastMove.prevY);
    setLastMove(null);
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  // Clear the selection if its layer gets hidden via the Layers panel. Done
  // during render (guarded so it settles in one pass) rather than in an effect.
  if (selectedId && selectedMarker && !isMarkerVisible(selectedMarker, hidden)) {
    setSelectedId(null);
  }

  if (!activeCampaignId) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Select a campaign first.</div>;
  }
  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Couldn&apos;t load the world map for this campaign.
      </div>
    );
  }
  if (loading || !worldMapId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <span className="font-medium text-sm">Exandria — World Map</span>
        <div className="flex items-center gap-2 flex-none">
          {markers.length === 0 && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={importing} onClick={importLocations}>
              <Download className="w-3.5 h-3.5" />
              {importing ? "Importing…" : "Import Exandria locations"}
            </Button>
          )}
          <MarkerLayerControl markers={markers} hidden={hidden} onChange={updateHidden} />
          <Button
            size="sm"
            variant={showLabels ? "initiative" : "outline"}
            onClick={toggleLabels}
            className="gap-1.5"
            title="Show or hide marker name labels on the map"
          >
            <Tag className="w-3.5 h-3.5" />
            {showLabels ? "Hide Labels" : "Show Labels"}
          </Button>
          <select
            value={theme}
            onChange={(e) => changeTheme(e.target.value)}
            aria-label="Map theme"
            className="text-xs bg-muted border border-border rounded-md px-2 py-1"
            title="Map theme"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={moveMode ? "initiative" : "outline"}
            onClick={() => {
              setMoveMode((v) => !v);
              setAddMode(false);
            }}
            className="gap-1.5"
            title="Toggle dragging markers to reposition them"
          >
            <Move className="w-3.5 h-3.5" />
            {moveMode ? "Done Moving" : "Move Pins"}
          </Button>
          <Button
            size="sm"
            variant={addMode ? "initiative" : "outline"}
            onClick={() => {
              setAddMode((v) => !v);
              setMoveMode(false);
            }}
            className="gap-1.5"
          >
            {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {addMode ? "Cancel" : "Add Marker"}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <WorldMapCanvas
          theme={theme}
          markers={visibleMarkers}
          selectedId={selectedId}
          showLabels={showLabels}
          addMode={addMode}
          markersDraggable={moveMode}
          onMapClick={handleMapClick}
          onMarkerClick={(m) => setSelectedId(m.id === selectedId ? null : m.id)}
          onMarkerDragEnd={handleMarkerDragEnd}
          onZoomChange={setViewZoom}
        />

        {lastMove && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-xl z-[1100]">
            <span className="text-sm">
              Moved <span className="font-medium">{lastMove.title}</span>.
            </span>
            <button onClick={undoMove} className="text-sm font-medium text-primary hover:underline">
              Undo
            </button>
            <button onClick={() => setLastMove(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {selectedMarker && (
          <MarkerInfoPanel
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEdit={() => {
              setEditing(selectedMarker);
              setSelectedId(null);
            }}
            onDelete={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers(worldMapId);
            }}
          />
        )}
      </div>

      {(pending || editing) && (
        <MarkerFormDialog
          mapId={worldMapId}
          campaignId={activeCampaignId}
          position={pending}
          marker={editing}
          currentZoom={viewZoom}
          onClose={() => {
            setPending(null);
            setEditing(null);
          }}
          onSaved={() => {
            setPending(null);
            setEditing(null);
            loadMarkers(worldMapId);
          }}
        />
      )}
    </div>
  );
}
