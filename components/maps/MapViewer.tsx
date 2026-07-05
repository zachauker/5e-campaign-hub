"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { StaticMapCanvas } from "@/components/maps/StaticMapCanvas";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { FeatureFormDialog } from "@/components/maps/FeatureFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { MapData, ResolvedMarker, MapFeatureData, FeatureType } from "@/components/maps/map-types";

const TiledMapCanvas = dynamic(
  () => import("@/components/maps/TiledMapCanvas").then((mod) => mod.TiledMapCanvas),
  { ssr: false }
);
const VectorMapCanvas = dynamic(
  () => import("@/components/maps/VectorMapCanvas").then((mod) => mod.VectorMapCanvas),
  { ssr: false }
);

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };

const DRAW_MODE_LABEL: Record<FeatureType, string> = { region: "Draw Region", road: "Draw Road", label: "Place Label" };

export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [features, setFeatures] = useState<MapFeatureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [drawMode, setDrawMode] = useState<FeatureType | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const [pendingFeature, setPendingFeature] = useState<{ type: FeatureType; geometry: GeoJSON.Geometry } | null>(null);
  const [editingFeature, setEditingFeature] = useState<MapFeatureData | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);

  const loadMarkers = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, [id]);

  const loadFeatures = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/features`);
    if (res.ok) setFeatures(await res.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [mapRes] = await Promise.all([fetch(`/api/maps/${id}`), loadMarkers()]);
        if (cancelled) return;
        const mapData: MapData | null = mapRes.ok ? await mapRes.json() : null;
        setMap(mapData);
        if (mapData?.isWorldMap) await loadFeatures();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers, loadFeatures]);

  function handleCanvasClick(pos: { x: number; y: number }) {
    setPendingPosition(pos);
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function handleMarkerDragMove(markerId: string, pos: { x: number; y: number }) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, ...pos } : m)));
  }

  function handleMarkerDragEnd(markerId: string, pos: { x: number; y: number }) {
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
    });
  }

  function handleFeatureClick(featureId: string) {
    const feature = features.find((f) => f.id === featureId);
    if (feature) setEditingFeature(feature);
  }

  function handleFeatureDrawn(type: FeatureType, geometry: GeoJSON.Geometry) {
    setPendingFeature({ type, geometry });
    setDrawMode(null);
  }

  async function togglePromotion() {
    if (!map || promoting) return;
    const confirmed = map.isWorldMap
      ? confirm("Remove this map as the campaign's World Map?")
      : confirm("Set this as the campaign's World Map? Any other World Map in this campaign will be unset.");
    if (!confirmed) return;
    const nextIsWorldMap = !map.isWorldMap;
    setPromoting(true);
    try {
      const res = await fetch(`/api/maps/${map.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isWorldMap: nextIsWorldMap }),
      });
      if (!res.ok) {
        alert("Failed to update World Map status. Please try again.");
        return;
      }
      // setMap and loadFeatures must stay sequential (not Promise.all) so
      // VectorMapCanvas never mounts with isWorldMap true before features
      // has had a chance to load.
      setMap({ ...map, isWorldMap: nextIsWorldMap });
      if (nextIsWorldMap) await loadFeatures();
    } finally {
      setPromoting(false);
    }
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!map) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Map not found.</p>
        <Button onClick={() => router.push("/maps")}>Back to Maps</Button>
      </div>
    );
  }

  const sharedCanvasProps = {
    map,
    markers,
    addMode,
    selectedId,
    onImageClick: handleCanvasClick,
    onMarkerClick: handleMarkerClick,
    onMarkerDragMove: handleMarkerDragMove,
    onMarkerDragEnd: handleMarkerDragEnd,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <Link href="/maps" className="text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Maps
          </Link>
          {map.breadcrumb.map((b) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <Link href={`/maps/${b.id}`} className="text-muted-foreground hover:text-foreground truncate">
                {b.name}
              </Link>
            </React.Fragment>
          ))}
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium truncate">{map.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {map.renderMode === "tiled" && map.parentMapId === null && (
            <Button size="sm" variant="outline" onClick={togglePromotion} disabled={promoting}>
              {map.isWorldMap ? "Remove World Map" : "Set as World Map"}
            </Button>
          )}
          {map.isWorldMap &&
            (["region", "road", "label"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={drawMode === t ? "initiative" : "outline"}
                onClick={() => {
                  setDrawMode((cur) => (cur === t ? null : t));
                  setAddMode(false);
                }}
              >
                {DRAW_MODE_LABEL[t]}
              </Button>
            ))}
          <Button
            size="sm"
            variant={addMode ? "initiative" : "outline"}
            onClick={() => {
              setAddMode((v) => !v);
              setDrawMode(null);
            }}
            className="gap-1.5"
          >
            {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {addMode ? "Cancel" : "Add Marker"}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {map.isWorldMap ? (
          <VectorMapCanvas
            {...sharedCanvasProps}
            features={features}
            drawMode={drawMode}
            onFeatureClick={handleFeatureClick}
            onFeatureDrawn={handleFeatureDrawn}
            onZoomChange={setViewZoom}
          />
        ) : map.renderMode === "tiled" ? (
          <TiledMapCanvas {...sharedCanvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...sharedCanvasProps} />
        )}

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2 z-[1000]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{selectedMarker.resolvedTitle}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{selectedMarker.type}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {selectedMarker.type === "note" && selectedMarker.note && (
              <p className="text-sm text-muted-foreground">{selectedMarker.note}</p>
            )}
            {selectedMarker.resolvedSubtitle && (
              <p className="text-xs text-destructive">{selectedMarker.resolvedSubtitle}</p>
            )}
            <div className="flex gap-2 pt-1">
              {ENTITY_PATH[selectedMarker.type] && selectedMarker.entityId && (
                <Link
                  href={`/${ENTITY_PATH[selectedMarker.type]}/${selectedMarker.entityId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View {selectedMarker.type} →
                </Link>
              )}
              <button
                onClick={() => {
                  setEditingMarker(selectedMarker);
                  setSelectedId(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
                  setSelectedId(null);
                  loadMarkers();
                }}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {(pendingPosition || editingMarker) && (
        <MarkerFormDialog
          mapId={map.id}
          campaignId={activeCampaignId ?? ""}
          position={pendingPosition}
          marker={editingMarker}
          currentZoom={map.renderMode === "tiled" ? viewZoom : undefined}
          onClose={() => {
            setPendingPosition(null);
            setEditingMarker(null);
          }}
          onSaved={() => {
            setPendingPosition(null);
            setEditingMarker(null);
            loadMarkers();
          }}
        />
      )}

      {(pendingFeature || editingFeature) && (
        <FeatureFormDialog
          mapId={map.id}
          type={pendingFeature?.type ?? editingFeature!.type}
          geometry={pendingFeature?.geometry ?? null}
          feature={editingFeature}
          onClose={() => {
            setPendingFeature(null);
            setEditingFeature(null);
          }}
          onSaved={() => {
            setPendingFeature(null);
            setEditingFeature(null);
            loadFeatures();
          }}
          onDeleted={() => {
            setEditingFeature(null);
            loadFeatures();
          }}
        />
      )}
    </div>
  );
}
