"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Plus, X, ChevronRight, Move, Pencil, Trash2, Tag } from "lucide-react";
import { StaticMapCanvas } from "@/components/maps/StaticMapCanvas";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { MarkerSlideOver } from "@/components/maps/MarkerSlideOver";
import { UnpinnedNotesTray } from "@/components/maps/UnpinnedNotesTray";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { MapData, ResolvedMarker } from "@/components/maps/map-types";
import { MarkerLayerControl } from "@/components/maps/MarkerLayerControl";
import { isMarkerVisible, readHiddenLayers } from "@/components/maps/marker-layers";
import { readShowLabels, writeShowLabels } from "@/components/maps/marker-labels";
import { EventDateFilter } from "@/components/maps/EventDateFilter";
import { eventDatesOf, defaultEventDate, filterByEventDate, todayISO } from "@/components/maps/event-date-filter";

const TiledMapCanvas = dynamic(
  () => import("@/components/maps/TiledMapCanvas").then((mod) => mod.TiledMapCanvas),
  { ssr: false }
);


export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const toast = useToast();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);
  const [moveMode, setMoveMode] = useState(false);
  const [lastMove, setLastMove] = useState<{ markerId: string; prevX: number; prevY: number; title: string } | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [trayReloadKey, setTrayReloadKey] = useState(0);
  // Snapshot of a marker's position at the start of a drag (dragMove updates
  // local state live, so the pre-drag position must be captured on first move).
  const dragOriginRef = useRef<{ id: string; x: number; y: number } | null>(null);

  // Seed from localStorage on mount; re-read during render if the map id changes
  // (React's recommended pattern for adjusting state on a prop change).
  const [hidden, setHidden] = useState<Set<string>>(() => readHiddenLayers(id));
  const [hiddenLoadedFor, setHiddenLoadedFor] = useState(id);
  if (id !== hiddenLoadedFor) {
    setHiddenLoadedFor(id);
    setHidden(readHiddenLayers(id));
  }

  function updateHidden(next: Set<string>) {
    setHidden(next);
    window.localStorage.setItem(`markerLayers:${id}`, JSON.stringify([...next]));
  }

  const [showLabels, setShowLabels] = useState<boolean>(() => readShowLabels(id));
  const [labelsLoadedFor, setLabelsLoadedFor] = useState(id);
  if (id !== labelsLoadedFor) {
    setLabelsLoadedFor(id);
    setShowLabels(readShowLabels(id));
  }

  function toggleLabels() {
    const next = !showLabels;
    setShowLabels(next);
    writeShowLabels(id, next);
  }

  // Seed the selected session date ONCE, the first time event dates appear,
  // defaulting to the next upcoming session. After that the user's choice
  // (including "All dates" = null) is preserved across marker reloads; we only
  // override when a chosen date has disappeared from the set, falling back to
  // the default (or null if no dates remain). Done during render, mirroring the
  // `hidden` block above, rather than in an effect.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateFilterSeeded, setDateFilterSeeded] = useState(false);
  const eventDates = eventDatesOf(markers);
  if (!dateFilterSeeded && eventDates.length > 0) {
    setDateFilterSeeded(true);
    setSelectedDate(defaultEventDate(eventDates, todayISO()));
  } else if (selectedDate !== null && !eventDates.includes(selectedDate)) {
    // the user's chosen date disappeared — fall back
    setSelectedDate(eventDates.length > 0 ? defaultEventDate(eventDates, todayISO()) : null);
  }

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
        const mapData: MapData | null = mapRes.ok ? await mapRes.json() : null;
        setMap(mapData);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers]);

  function handleCanvasClick(pos: { x: number; y: number }) {
    if (pendingNoteId) {
      const noteId = pendingNoteId;
      setPendingNoteId(null);
      setAddMode(false);
      fetch(`/api/maps/${id}/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: pos.x, y: pos.y, type: "event", entityId: noteId }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast({ title: "Couldn’t place note", description: data.error ?? "Please try again.", variant: "error" });
            return;
          }
          loadMarkers();
          setTrayReloadKey((k) => k + 1);
        })
        .catch(() => {
          toast({ title: "Couldn’t place note", description: "Please try again.", variant: "error" });
        });
      return;
    }
    setPendingPosition(pos);
    setAddMode(false);
  }

  function pickUnpinnedNote(noteId: string) {
    setPendingNoteId(noteId);
    setAddMode(true);
    setMoveMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function handleMarkerDragMove(markerId: string, pos: { x: number; y: number }) {
    if (dragOriginRef.current?.id !== markerId) {
      const cur = markers.find((m) => m.id === markerId);
      if (cur) dragOriginRef.current = { id: markerId, x: cur.x, y: cur.y };
    }
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, ...pos } : m)));
  }

  function persistMarkerPosition(markerId: string, x: number, y: number) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, x, y } : m)));
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
  }

  function handleMarkerDragEnd(markerId: string, pos: { x: number; y: number }) {
    const origin = dragOriginRef.current;
    if (origin && origin.id === markerId) {
      const m = markers.find((x) => x.id === markerId);
      setLastMove({ markerId, prevX: origin.x, prevY: origin.y, title: m?.resolvedTitle ?? "marker" });
    }
    dragOriginRef.current = null;
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
    });
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

  function openRename() {
    if (!map) return;
    setRenameValue(map.name);
    setRenameOpen(true);
  }

  async function submitRename() {
    const name = renameValue.trim();
    if (!map || !name) return;
    setRenameSaving(true);
    try {
      await fetch(`/api/maps/${map.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setMap({ ...map, name });
      setRenameOpen(false);
    } finally {
      setRenameSaving(false);
    }
  }

  async function removeMap() {
    if (!map) return;
    const ok = await confirm({
      title: `Delete “${map.name}”?`,
      description: "This permanently deletes the map and its image.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/maps/${map.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: "Couldn’t delete map", description: data.error ?? "Please try again.", variant: "error" });
      return;
    }
    router.push("/maps");
  }

  const sharedCanvasProps = {
    map,
    markers: filterByEventDate(markers.filter((m) => isMarkerVisible(m, hidden)), selectedDate),
    addMode,
    markersDraggable: moveMode,
    selectedId,
    showLabels,
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
          <div className="flex items-center gap-0.5 flex-none pl-1">
            <button
              onClick={openRename}
              aria-label="Rename map"
              title="Rename map"
              className="p-1 rounded text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={removeMap}
              aria-label="Delete map"
              title="Delete map"
              className="p-1 rounded text-muted-foreground/60 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <EventDateFilter dates={eventDates} selected={selectedDate} onChange={setSelectedDate} />
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
          <Button
            size="sm"
            variant={moveMode ? "initiative" : "outline"}
            onClick={() => {
              setMoveMode((v) => !v);
              setAddMode(false);
              setPendingNoteId(null);
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
              setPendingNoteId(null);
            }}
            className="gap-1.5"
          >
            {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {addMode ? "Cancel" : "Add Marker"}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {map.renderMode === "tiled" ? (
          <TiledMapCanvas {...sharedCanvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...sharedCanvasProps} />
        )}

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

        {activeCampaignId && (
          <UnpinnedNotesTray
            campaignId={activeCampaignId}
            date={selectedDate}
            reloadKey={trayReloadKey}
            onPick={pickUnpinnedNote}
          />
        )}

        {selectedMarker && (
          <MarkerSlideOver
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEditPin={() => {
              setEditingMarker(selectedMarker);
              setSelectedId(null);
            }}
            onDeletePin={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers();
              setTrayReloadKey((k) => k + 1);
            }}
          />
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
            setTrayReloadKey((k) => k + 1);
          }}
        />
      )}

      <Dialog open={renameOpen} onOpenChange={(o) => !o && setRenameOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename map</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            placeholder="Map name"
            aria-label="Map name"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={renameSaving || !renameValue.trim()}>
              {renameSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
