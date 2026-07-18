"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, Marker, addProtocol, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import { MarkerLabel } from "@/components/maps/MarkerLabel";
import type { ResolvedMarker } from "@/components/maps/map-types";

// Register the pmtiles:// protocol once for the whole app. The Protocol instance
// is module-level so it (and its tile cache) persists for the app's lifetime.
const pmtilesProtocol = new Protocol();
let pmtilesRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesRegistered) return;
  addProtocol("pmtiles", pmtilesProtocol.tile);
  pmtilesRegistered = true;
}

const WORLD_CENTER: [number, number] = [11.806, 5.193];
const WORLD_MIN_ZOOM = 3;
const WORLD_MAX_ZOOM = 12;

export interface WorldMapCanvasProps {
  theme: string;
  addMode: boolean;
  markersDraggable: boolean;
  onMapClick: (lngLat: { lng: number; lat: number }) => void;
  onReady?: (map: MapLibreMap) => void;
  onZoomChange?: (zoom: number) => void;
  markers: ResolvedMarker[];
  selectedId: string | null;
  showLabels: boolean;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragEnd: (markerId: string, lngLat: { lng: number; lat: number }) => void;
}

// Point a fetched theme style at the app's world-asset routes.
function fixupStyle(style: StyleSpecification, origin: string): StyleSpecification {
  const src = style.sources?.exandria;
  if (src && "url" in src) src.url = `pmtiles://${origin}/api/world/exandria.pmtiles`;
  style.glyphs = `${origin}/api/world/glyphs/{fontstack}/{range}.pbf`;
  return style;
}

async function loadThemeStyle(theme: string, origin: string): Promise<StyleSpecification> {
  const res = await fetch(`/api/world/styles/${theme}.json`);
  if (!res.ok) throw new Error(`theme ${theme} not found`);
  return fixupStyle(await res.json(), origin);
}

export function WorldMapCanvas({
  theme,
  addMode,
  markersDraggable,
  onMapClick,
  onReady,
  onZoomChange,
  markers,
  selectedId,
  showLabels,
  onMarkerClick,
  onMarkerDragEnd,
}: WorldMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const markerInstancesRef = useRef<Map<string, Marker>>(new Map());
  const [zoom, setZoom] = useState<number>(WORLD_MIN_ZOOM);
  const markerCbRef = useRef({ onMarkerClick, onMarkerDragEnd });
  useEffect(() => {
    markerCbRef.current = { onMarkerClick, onMarkerDragEnd };
  });
  // Kept in a ref so markers created lazily (on zoom reveal) pick up the current
  // value without the marker-sync effect depending on it.
  const markersDraggableRef = useRef(markersDraggable);
  useEffect(() => {
    markersDraggableRef.current = markersDraggable;
  });

  const cbRef = useRef({ addMode, onMapClick, onReady, onZoomChange });
  useEffect(() => {
    cbRef.current = { addMode, onMapClick, onReady, onZoomChange };
  });

  // Mount once. Theme changes are handled by the separate effect below.
  useEffect(() => {
    if (!containerRef.current) return;
    ensurePmtilesProtocol();
    let cancelled = false;
    let glMap: MapLibreMap | null = null;

    loadThemeStyle(theme, window.location.origin)
      .then((style) => {
        if (cancelled || !containerRef.current) return;
        glMap = new MapLibreMap({
          container: containerRef.current,
          style,
          center: WORLD_CENTER,
          zoom: 4,
          minZoom: WORLD_MIN_ZOOM,
          maxZoom: WORLD_MAX_ZOOM,
          renderWorldCopies: false,
          attributionControl: false,
        });
        glMapRef.current = glMap;

        glMap.on("error", (e) => {
          console.error("MapLibre error:", e.error);
          if (!readyRef.current) setMapError("Failed to load the world map. Try refreshing.");
        });
        glMap.on("click", (e: MapMouseEvent) => {
          if (cbRef.current.addMode) cbRef.current.onMapClick(e.lngLat);
        });
        glMap.on("zoomend", () => {
          setZoom(glMap!.getZoom());
          cbRef.current.onZoomChange?.(glMap!.getZoom());
        });
        glMap.on("load", () => {
          setReady(true);
          setZoom(glMap!.getZoom());
          cbRef.current.onZoomChange?.(glMap!.getZoom());
          cbRef.current.onReady?.(glMap!);
        });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setMapError("Failed to load the world map. Try refreshing.");
      });

    return () => {
      cancelled = true;
      for (const inst of markerInstancesRef.current.values()) inst.remove();
      markerInstancesRef.current.clear();
      glMap?.remove();
      glMapRef.current = null;
      setReady(false);
    };
    // Mount once; theme handled separately so the map isn't torn down on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // Cursor feedback for add-marker mode.
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap) return;
    glMap.getCanvasContainer().style.cursor = addMode ? "crosshair" : "";
  }, [addMode, ready]);

  // Switch theme without remounting (camera preserved).
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    let cancelled = false;
    loadThemeStyle(theme, window.location.origin).then((style) => {
      if (!cancelled) glMap.setStyle(style);
    });
    return () => {
      cancelled = true;
    };
  }, [theme, ready]);

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const instances = markerInstancesRef.current;
    const visible = markers.filter((m) => m.minZoom === null || zoom >= m.minZoom);
    const seen = new Set(visible.map((m) => m.id));

    for (const [id, inst] of instances) {
      if (!seen.has(id)) {
        inst.remove();
        instances.delete(id);
      }
    }

    let revealIndex = 0; // stagger newly-revealed pins within this batch
    for (const marker of visible) {
      const lngLat: [number, number] = [marker.x, marker.y]; // x=lng, y=lat for world maps
      const sel = marker.id === selectedId;
      let inst = instances.get(marker.id);
      if (!inst) {
        const el = document.createElement("div");
        el.innerHTML = renderToStaticMarkup(
          <>
            <MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={sel} />
            {showLabels && <MarkerLabel text={marker.resolvedTitle} />}
          </>
        );
        el.dataset.sel = sel ? "1" : "0";
        el.dataset.lbl = showLabels ? "1" : "0";
        // Staggered rise-in for newly-revealed pins (skip the selected one — it
        // gets the bloom instead, and two transform animations would fight).
        const pin = el.firstElementChild as HTMLElement | null;
        if (pin && !sel) {
          pin.classList.add("marker-rise");
          pin.style.animationDelay = `${Math.min(revealIndex * 14, 280)}ms`;
          revealIndex++;
        }
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          markerCbRef.current.onMarkerClick(marker);
        });
        inst = new Marker({ element: el, draggable: markersDraggableRef.current, anchor: "bottom" })
          .setLngLat(lngLat)
          .addTo(glMap);
        inst.on("dragend", () => {
          const { lng, lat } = inst!.getLngLat();
          markerCbRef.current.onMarkerDragEnd(marker.id, { lng, lat });
        });
        instances.set(marker.id, inst);
      } else {
        inst.setLngLat(lngLat);
        // Regenerate the pin+label markup when either the selected state or the
        // label visibility changes. This stops per-zoom churn (a perf win) and
        // lets the freshly-mounted selected pin play its one-shot arrival bloom.
        const el = inst.getElement();
        if (el.dataset.sel !== (sel ? "1" : "0") || el.dataset.lbl !== (showLabels ? "1" : "0")) {
          el.innerHTML = renderToStaticMarkup(
            <>
              <MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={sel} />
              {showLabels && <MarkerLabel text={marker.resolvedTitle} />}
            </>
          );
          el.dataset.sel = sel ? "1" : "0";
          el.dataset.lbl = showLabels ? "1" : "0";
        }
      }
    }
  }, [markers, selectedId, ready, zoom, showLabels]);

  // Toggle draggability on existing marker instances when Move mode changes.
  useEffect(() => {
    for (const inst of markerInstancesRef.current.values()) inst.setDraggable(markersDraggable);
  }, [markersDraggable, markers, zoom, ready]);

  // Cinematic fly-to: when a marker is selected, glide the camera to it (and
  // zoom in enough to reveal it) instead of a hard jump. Guarded by a ref so it
  // fires once per selection even as markers stream in; reduced-motion jumps.
  const lastFlownRef = useRef<string | null>(null);
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    if (!selectedId) {
      lastFlownRef.current = null;
      return;
    }
    if (selectedId === lastFlownRef.current) return;
    const m = markers.find((mk) => mk.id === selectedId);
    if (!m) return;
    lastFlownRef.current = selectedId;
    const center: [number, number] = [m.x, m.y];
    const targetZoom = Math.max(glMap.getZoom(), m.minZoom ?? 6);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      glMap.jumpTo({ center, zoom: targetZoom });
    } else {
      glMap.flyTo({
        center,
        zoom: targetZoom,
        curve: 1.42,
        speed: 0.85,
        easing: (t) => 1 - Math.pow(1 - t, 4),
      });
    }
  }, [selectedId, ready, markers]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black/40">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-destructive bg-card/90 border border-border rounded-md px-3 py-2">{mapError}</p>
        </div>
      )}
    </div>
  );
}
