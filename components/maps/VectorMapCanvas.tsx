"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, Marker, GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawRenderMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import {
  fractionalToLngLat,
  lngLatToFractional,
  geometryToLngLat,
  geometryToFractional,
  getReferenceTileBounds,
  getMercatorMinZoom,
  type MapDims,
} from "@/lib/maps/mercator-adapter";
import type { MapData, ResolvedMarker, MapFeatureData, FeatureType } from "@/components/maps/map-types";

export interface VectorMapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  features: MapFeatureData[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onFeatureClick: (featureId: string) => void;
  drawMode: FeatureType | null;
  onFeatureDrawn: (type: FeatureType, geometry: GeoJSON.Geometry) => void;
  onZoomChange?: (zoom: number) => void;
}

const TERRA_MODE_NAME: Record<FeatureType, string> = { region: "polygon", road: "linestring", label: "point" };

export function VectorMapCanvas({
  map,
  markers,
  features,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  onFeatureClick,
  drawMode,
  onFeatureDrawn,
  onZoomChange,
}: VectorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const markerInstancesRef = useRef<Map<string, Marker>>(new Map());
  const drawRef = useRef<TerraDraw | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const featureClickCallbackRef = useRef(onFeatureClick);
  const onZoomChangeRef = useRef(onZoomChange);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  });

  const dims: MapDims = { width: map.width ?? 0, height: map.height ?? 0, maxZoom: map.maxZoom ?? 0 };

  const drawCallbacksRef = useRef({ drawMode, onFeatureDrawn, dims });
  useEffect(() => {
    drawCallbacksRef.current = { drawMode, onFeatureDrawn, dims };
  });

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

    glMap.on("error", (e) => {
      console.error("MapLibre error:", e.error);
      if (!readyRef.current) {
        setMapError("Failed to load the map. Try refreshing the page.");
      }
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

      glMap.addSource("features", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      glMap.addLayer({
        id: "region-fill",
        type: "fill",
        source: "features",
        filter: ["==", ["get", "type"], "region"],
        paint: { "fill-color": ["coalesce", ["get", "fillColor"], "#4a7c59"], "fill-opacity": 0.35 },
      });
      glMap.addLayer({
        id: "region-outline",
        type: "line",
        source: "features",
        filter: ["==", ["get", "type"], "region"],
        paint: { "line-color": ["coalesce", ["get", "strokeColor"], "#4a7c59"], "line-width": 2 },
      });
      glMap.addLayer({
        id: "road-line",
        type: "line",
        source: "features",
        filter: ["==", ["get", "type"], "road"],
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#8a6d3b"],
          "line-width": ["coalesce", ["get", "width"], 2],
          "line-dasharray": ["case", ["get", "dash"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      });
      glMap.addLayer({
        id: "label-text",
        type: "symbol",
        source: "features",
        filter: ["==", ["get", "type"], "label"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["coalesce", ["get", "fontSize"], 14],
          "text-allow-overlap": false,
        },
        paint: { "text-color": ["coalesce", ["get", "color"], "#e8e2d4"] },
      });

      for (const layerId of ["region-fill", "road-line", "label-text"]) {
        glMap.on("click", layerId, (e) => {
          const id = e.features?.[0]?.properties?.featureId;
          if (typeof id === "string") featureClickCallbackRef.current(id);
        });
      }

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: glMap }),
        modes: [
          new TerraDrawPolygonMode(),
          new TerraDrawLineStringMode(),
          new TerraDrawPointMode(),
          new TerraDrawRenderMode({ modeName: "render", styles: {} }),
        ],
      });
      draw.start();
      draw.setMode("render");
      draw.on("finish", (id) => {
        const snapshot = draw.getSnapshotFeature(id);
        const { drawMode: currentDrawMode, onFeatureDrawn: currentOnFeatureDrawn, dims: currentDims } = drawCallbacksRef.current;
        if (!snapshot || !currentDrawMode) return;
        const geometry = snapshot.geometry as GeoJSON.Geometry;
        currentOnFeatureDrawn(currentDrawMode, geometryToFractional(geometry, currentDims));
        draw.removeFeatures([id]);
        draw.setMode("render");
      });
      drawRef.current = draw;

      const initialZoom = glMap.getZoom();
      setZoom(initialZoom);
      onZoomChangeRef.current?.(initialZoom);
      setReady(true);
    });

    glMap.on("zoomend", () => {
      const newZoom = glMap.getZoom();
      setZoom(newZoom);
      onZoomChangeRef.current?.(newZoom);
    });

    glMapRef.current = glMap;
    const markerInstances = markerInstancesRef.current;
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      for (const instance of markerInstances.values()) instance.remove();
      markerInstances.clear();
      glMap.remove();
      glMapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map.id/maxZoom are fixed for a mounted World Map
  }, [map.id]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

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
    featureClickCallbackRef.current = onFeatureClick;
  });

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const instances = markerInstancesRef.current;
    const visibleMarkers = markers.filter((m) => m.minZoom === null || zoom === null || zoom >= m.minZoom);
    const seenIds = new Set(visibleMarkers.map((m) => m.id));

    for (const [id, instance] of instances) {
      if (!seenIds.has(id)) {
        instance.remove();
        instances.delete(id);
      }
    }

    for (const marker of visibleMarkers) {
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
  }, [markers, selectedId, ready, zoom]);

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const source = glMap.getSource("features");
    if (!(source instanceof GeoJSONSource)) return;
    source.setData({
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        id: f.id,
        geometry: geometryToLngLat(f.geometry, dims),
        properties: { featureId: f.id, type: f.type, name: f.name, ...f.style },
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dims is derived fresh each render from stable map fields
  }, [features, ready]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;
    draw.setMode(drawMode ? TERRA_MODE_NAME[drawMode] : "render");
  }, [drawMode, ready]);

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
