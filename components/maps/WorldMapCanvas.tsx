"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, addProtocol, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";

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
  onMapClick: (lngLat: { lng: number; lat: number }) => void;
  onReady?: (map: MapLibreMap) => void;
  onZoomChange?: (zoom: number) => void;
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

export function WorldMapCanvas({ theme, addMode, onMapClick, onReady, onZoomChange }: WorldMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

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
        glMap.on("zoomend", () => cbRef.current.onZoomChange?.(glMap!.getZoom()));
        glMap.on("load", () => {
          setReady(true);
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
