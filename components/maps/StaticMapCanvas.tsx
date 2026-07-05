"use client";

import React, { useState, useRef } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import type { MapCanvasProps } from "@/components/maps/map-types";

export function StaticMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
}: MapCanvasProps) {
  const [minScale, setMinScale] = useState(0.5);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const viewport = viewportRef.current;
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!viewport || !naturalWidth || !naturalHeight) return;
    const { width: viewportWidth, height: viewportHeight } = viewport.getBoundingClientRect();
    const fitScale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    setMinScale(Math.min(1, Math.max(0.05, fitScale)));
  }

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onImageClick({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }

  function startDrag(markerId: string, e: React.PointerEvent) {
    e.stopPropagation();
    draggingRef.current = markerId;
    const container = containerRef.current;
    if (!container) return;

    function posFromEvent(ev: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      };
    }
    function onMove(ev: PointerEvent) {
      onMarkerDragMove(markerId, posFromEvent(ev));
    }
    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      draggingRef.current = null;
    }
    function onUp(ev: PointerEvent) {
      cleanup();
      onMarkerDragEnd(markerId, posFromEvent(ev));
    }
    function onCancel() {
      cleanup();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return (
    <div ref={viewportRef} className="relative flex-1 overflow-hidden bg-black/40">
      <TransformWrapper disabled={addMode} doubleClick={{ disabled: true }} minScale={minScale} maxScale={6}>
        <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-fit !h-fit">
          <div
            ref={containerRef}
            className="relative"
            style={{ cursor: addMode ? "crosshair" : "default" }}
            onClick={handleContainerClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map image, arbitrary user-upload dimensions */}
            <img
              src={`/api/maps/${map.id}/image`}
              alt={map.name}
              onLoad={handleImageLoad}
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
                  onMarkerClick(m);
                }}
              >
                <MapMarkerPin type={m.type} selected={m.id === selectedId} />
              </div>
            ))}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
