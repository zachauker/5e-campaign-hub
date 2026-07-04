"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, Marker, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import {
  fractionalToLngLat,
  lngLatToFractional,
  getReferenceTileBounds,
  getMercatorMinZoom,
  type MapDims,
} from "@/lib/maps/mercator-adapter";
import type { MapData, ResolvedMarker } from "@/components/maps/map-types";

export interface VectorMapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
}

export function VectorMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
}: VectorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const markerInstancesRef = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);

  const dims: MapDims = { width: map.width ?? 0, height: map.height ?? 0, maxZoom: map.maxZoom ?? 0 };

  useEffect(() => {
    if (!containerRef.current) return;
    const { west, south, east, north } = getReferenceTileBounds();
    const bounds: [number, number, number, number] = [west, south, east, north];
    const referenceZoom = getMercatorMinZoom();

    const glMap = new MapLibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      bounds,
      maxBounds: bounds,
      minZoom: referenceZoom,
      maxZoom: referenceZoom + (map.maxZoom ?? 0),
      renderWorldCopies: false,
      attributionControl: false,
    });

    glMap.on("load", () => {
      glMap.addSource("base-tiles", {
        type: "raster",
        tiles: [`/api/maps/${map.id}/vtiles/{z}/{x}/{y}.jpg`],
        tileSize: 256,
        bounds,
        maxzoom: referenceZoom + (map.maxZoom ?? 0),
      });
      glMap.addLayer({ id: "base-tiles-layer", type: "raster", source: "base-tiles" });
      setReady(true);
    });

    glMapRef.current = glMap;
    return () => {
      glMap.remove();
      glMapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map.id/maxZoom are fixed for a mounted World Map
  }, [map.id]);

  const clickCallbacksRef = useRef({ addMode, onImageClick, dims });
  useEffect(() => {
    clickCallbacksRef.current = { addMode, onImageClick, dims };
  });

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap) return;
    const el = glMap.getCanvasContainer();
    el.style.cursor = addMode ? "crosshair" : "";

    function handleClick(e: MapMouseEvent) {
      const { addMode: currentAddMode, onImageClick: currentOnImageClick, dims: currentDims } = clickCallbacksRef.current;
      if (!currentAddMode) return;
      const pos = lngLatToFractional(e.lngLat.lng, e.lngLat.lat, currentDims);
      currentOnImageClick(pos);
    }
    glMap.on("click", handleClick);
    return () => {
      glMap.off("click", handleClick);
    };
  }, [addMode]);

  const markerCallbacksRef = useRef({ onMarkerClick, onMarkerDragMove, onMarkerDragEnd });
  useEffect(() => {
    markerCallbacksRef.current = { onMarkerClick, onMarkerDragMove, onMarkerDragEnd };
  });

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const instances = markerInstancesRef.current;
    const seenIds = new Set(markers.map((m) => m.id));

    for (const [id, instance] of instances) {
      if (!seenIds.has(id)) {
        instance.remove();
        instances.delete(id);
      }
    }

    for (const marker of markers) {
      const [lng, lat] = fractionalToLngLat(marker.x, marker.y, dims);
      let instance = instances.get(marker.id);
      if (!instance) {
        const el = document.createElement("div");
        el.innerHTML = renderToStaticMarkup(<MapMarkerPin type={marker.type} selected={marker.id === selectedId} />);
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          markerCallbacksRef.current.onMarkerClick(marker);
        });
        instance = new Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat([lng, lat]).addTo(glMap);
        instance.on("drag", () => {
          const { lng: dLng, lat: dLat } = instance!.getLngLat();
          markerCallbacksRef.current.onMarkerDragMove(marker.id, lngLatToFractional(dLng, dLat, dims));
        });
        instance.on("dragend", () => {
          const { lng: dLng, lat: dLat } = instance!.getLngLat();
          markerCallbacksRef.current.onMarkerDragEnd(marker.id, lngLatToFractional(dLng, dLat, dims));
        });
        instances.set(marker.id, instance);
      } else {
        instance.setLngLat([lng, lat]);
        instance.getElement().innerHTML = renderToStaticMarkup(
          <MapMarkerPin type={marker.type} selected={marker.id === selectedId} />
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dims is derived fresh each render from stable map fields
  }, [markers, selectedId, ready]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black/40">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
