export type MarkerType = "location" | "faction" | "character" | "submap" | "note";

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
}

export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
}

export type FeatureType = "region" | "road" | "label";

export interface RegionStyle {
  fillColor: string;
  strokeColor: string;
}

export interface RoadStyle {
  color: string;
  width: number;
  dash: boolean;
}

export interface LabelStyle {
  fontSize: number;
  color: string;
}

interface MapFeatureBase {
  id: string;
  mapId: string;
  name: string | null;
  geometry: GeoJSON.Geometry;
}

export interface MapFeatureRegion extends MapFeatureBase {
  type: "region";
  style: RegionStyle;
}

export interface MapFeatureRoad extends MapFeatureBase {
  type: "road";
  style: RoadStyle;
}

export interface MapFeatureLabel extends MapFeatureBase {
  type: "label";
  style: LabelStyle;
}

export type MapFeatureData = MapFeatureRegion | MapFeatureRoad | MapFeatureLabel;

export interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
  renderMode: "static" | "tiled";
  width: number | null;
  height: number | null;
  maxZoom: number | null;
  isWorldMap: boolean;
}

export interface MapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}
