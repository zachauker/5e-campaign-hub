import type { TypeAppearanceMap } from "@/components/maps/marker-appearance";

export type MarkerType = "location" | "faction" | "character" | "submap" | "note" | "event";

export interface MarkerData {
  id: string;
  mapId: string;
  x: number;
  y: number;
  type: MarkerType;
  entityId: string | null;
  targetMapId: string | null;
  title: string | null;
  note: string | null;
  minZoom: number | null;
  size: string | null;
  shape: string | null;
  icon: string | null;
  labelSize: string | null;
  color: string | null;
}

export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
  entitySubtype?: string | null; // location: loc.type; event: note's Notion Type
  eventDate?: string | null;     // event markers only: the note's Date (ISO), for filtering
}

export interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
  renderMode: "static" | "tiled" | "world";
  width: number | null;
  height: number | null;
  maxZoom: number | null;
}

export interface MapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  markersDraggable: boolean;
  selectedId: string | null;
  showLabels?: boolean;
  typeDefaults?: TypeAppearanceMap;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}
