"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerFormDialog, type MarkerData } from "@/components/maps/MarkerFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
}

interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
}

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };

export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadMarkers = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [mapRes] = await Promise.all([fetch(`/api/maps/${id}`), loadMarkers()]);
        if (cancelled) return;
        setMap(mapRes.ok ? await mapRes.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers]);

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPendingPosition({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (draggingRef.current) return;
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function startDrag(markerId: string, e: React.PointerEvent) {
    e.stopPropagation();
    draggingRef.current = markerId;
    const container = containerRef.current;
    if (!container) return;

    function onMove(ev: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, x, y } : m)));
    }
    async function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const rect = container!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      draggingRef.current = null;
      await fetch(`/api/maps/markers/${markerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
        <Button
          size="sm"
          variant={addMode ? "initiative" : "outline"}
          onClick={() => setAddMode((v) => !v)}
          className="gap-1.5 flex-none"
        >
          {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {addMode ? "Cancel" : "Add Marker"}
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black/40">
        <TransformWrapper panning={{ disabled: addMode }} doubleClick={{ disabled: true }} minScale={0.5} maxScale={6}>
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-fit !h-fit">
            <div ref={containerRef} className="relative" style={{ cursor: addMode ? "crosshair" : "default" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map image, arbitrary user-upload dimensions */}
              <img
                src={`/api/maps/${map.id}/image`}
                alt={map.name}
                onClick={handleImageClick}
                className="max-w-none select-none"
                draggable={false}
              />
              {markers.map((m) => (
                <div
                  key={m.id}
                  className="absolute -translate-x-1/2 -translate-y-full cursor-pointer"
                  style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                  onPointerDown={(e) => startDrag(m.id, e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMarkerClick(m);
                  }}
                >
                  <MapMarkerPin type={m.type} selected={m.id === selectedId} />
                </div>
              ))}
            </div>
          </TransformComponent>
        </TransformWrapper>

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2">
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
    </div>
  );
}
