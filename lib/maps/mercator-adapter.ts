const TILE_SIZE = 256;
const REFERENCE_ZOOM = 10;
const REFERENCE_TILE = 2 ** (REFERENCE_ZOOM - 1);

export interface MapDims {
  width: number;
  height: number;
  maxZoom: number;
}

/**
 * Converts the real Mercator z/x/y MapLibre requests back into the sharp
 * pyramid's own tile index. Returns null if mz is shallower than the
 * reference zoom (i.e. zoomed out past the whole image).
 */
export function mercatorToSharpTile(mz: number, mx: number, my: number) {
  const z = mz - REFERENCE_ZOOM;
  if (z < 0) return null;
  const scale = 2 ** z;
  return { z, x: mx - REFERENCE_TILE * scale, y: my - REFERENCE_TILE * scale };
}

function tileToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** The lng/lat rectangle of the single reference tile every World Map is pinned to. */
export function getReferenceTileBounds(): { west: number; south: number; east: number; north: number } {
  return {
    west: tileToLng(REFERENCE_TILE, REFERENCE_ZOOM),
    east: tileToLng(REFERENCE_TILE + 1, REFERENCE_ZOOM),
    north: tileToLat(REFERENCE_TILE, REFERENCE_ZOOM),
    south: tileToLat(REFERENCE_TILE + 1, REFERENCE_ZOOM),
  };
}

export function getMercatorMinZoom(): number {
  return REFERENCE_ZOOM;
}

/**
 * A source image's sharp-generated tile pyramid always pads its zoom-0 tile out
 * to a full TILE_SIZE x TILE_SIZE square (see lib/maps/storage.ts's tile
 * background fill) - the real image only occupies the top-left corner of that
 * square, sized by whichever of width/height is smaller relative to the other.
 * These fractions describe how much of the padded square is real content.
 */
function contentFractions(dims: MapDims): { lngFrac: number; latFrac: number } {
  const alignedSize = TILE_SIZE * 2 ** dims.maxZoom;
  return { lngFrac: dims.width / alignedSize, latFrac: dims.height / alignedSize };
}

/** fx/fy are the existing 0-1 image-fraction convention already used by map_markers. */
export function fractionalToLngLat(fx: number, fy: number, dims: MapDims): [number, number] {
  const { west, south, east, north } = getReferenceTileBounds();
  const { lngFrac, latFrac } = contentFractions(dims);
  const lng = west + fx * lngFrac * (east - west);
  const lat = north - fy * latFrac * (north - south);
  return [lng, lat];
}

export function lngLatToFractional(lng: number, lat: number, dims: MapDims): { x: number; y: number } {
  const { west, south, east, north } = getReferenceTileBounds();
  const { lngFrac, latFrac } = contentFractions(dims);
  return {
    x: (lng - west) / (lngFrac * (east - west)),
    y: (north - lat) / (latFrac * (north - south)),
  };
}

function convertPosition(pos: GeoJSON.Position, dims: MapDims): GeoJSON.Position {
  return fractionalToLngLat(pos[0], pos[1], dims);
}

function convertPositionBack(pos: GeoJSON.Position, dims: MapDims): GeoJSON.Position {
  const { x, y } = lngLatToFractional(pos[0], pos[1], dims);
  return [x, y];
}

/** Converts a map_features geometry (stored in 0-1 image-fraction coordinates) into real lng/lat for rendering. */
export function geometryToLngLat(geometry: GeoJSON.Geometry, dims: MapDims): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: convertPosition(geometry.coordinates, dims) };
    case "LineString":
      return { type: "LineString", coordinates: geometry.coordinates.map((p) => convertPosition(p, dims)) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map((p) => convertPosition(p, dims))),
      };
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}

/** Inverse of geometryToLngLat - converts a Terra Draw-emitted lng/lat geometry back into the 0-1 storage convention. */
export function geometryToFractional(geometry: GeoJSON.Geometry, dims: MapDims): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: convertPositionBack(geometry.coordinates, dims) };
    case "LineString":
      return { type: "LineString", coordinates: geometry.coordinates.map((p) => convertPositionBack(p, dims)) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map((p) => convertPositionBack(p, dims))),
      };
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}
