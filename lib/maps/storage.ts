import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { MapRow } from "@/lib/db/schema";

// Same volume the SQLite DB lives on (DB_PATH is /data/encounter-tracker.db
// in production, per docker-compose.yml's ./data:/data mount) — no new
// volume or env var needed.
const DATA_DIR = path.dirname(process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db"));
const MAPS_DIR = path.join(DATA_DIR, "maps");

export async function saveMapImage(mapId: string, file: File): Promise<string> {
  await fs.mkdir(MAPS_DIR, { recursive: true });
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const filename = `${mapId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(MAPS_DIR, filename), buffer);
  return filename;
}

/** Throws ENOENT if the file does not exist — callers must catch and handle it. */
export async function readMapImage(imagePath: string): Promise<Buffer> {
  return fs.readFile(path.join(MAPS_DIR, imagePath));
}

export async function deleteMapImage(imagePath: string): Promise<void> {
  await fs.rm(path.join(MAPS_DIR, imagePath), { force: true });
}

export function mapImageContentType(imagePath: string): string {
  const ext = imagePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

const TILE_SIZE = 256;

export async function saveTiledMapAssets(
  mapId: string,
  file: File
): Promise<{ imagePath: string; width: number; height: number; maxZoom: number }> {
  const mapDir = path.join(MAPS_DIR, mapId);
  await fs.mkdir(mapDir, { recursive: true });

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const originalFilename = `original.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(mapDir, originalFilename), buffer);

  const metadata = await sharp(buffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("Could not read image dimensions");
  }

  const tilesDir = path.join(mapDir, "tiles");
  try {
    await sharp(buffer)
      .jpeg({ quality: 85 })
      // Edge tiles (near-certain for any image whose dimensions aren't an
      // exact multiple of TILE_SIZE) get padded to a full tile - sharp
      // defaults that padding to opaque white, which stands out badly
      // against this app's dark theme. Black blends in instead.
      .tile({ size: TILE_SIZE, layout: "google", background: { r: 0, g: 0, b: 0 } })
      .toFile(tilesDir);
  } catch (err) {
    await fs.rm(mapDir, { recursive: true, force: true });
    throw err;
  }

  const zoomDirs = await fs.readdir(tilesDir, { withFileTypes: true });
  const maxZoom = Math.max(
    ...zoomDirs
      .filter((d) => d.isDirectory())
      .map((d) => parseInt(d.name, 10))
      .filter((n) => !Number.isNaN(n))
  );

  return { imagePath: `${mapId}/${originalFilename}`, width, height, maxZoom };
}

const NON_NEGATIVE_INT = /^\d+$/;

/**
 * Throws ENOENT if the tile does not exist, or if z/x/y are not bare
 * non-negative integers — callers must catch and handle it. This also
 * guards against path traversal, since z/x/y are interpolated directly
 * into a filesystem path.
 */
export async function readMapTile(mapId: string, z: string, x: string, y: string): Promise<Buffer> {
  if (!NON_NEGATIVE_INT.test(z) || !NON_NEGATIVE_INT.test(x) || !NON_NEGATIVE_INT.test(y)) {
    const err = new Error("Invalid tile coordinates") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  }
  // sharp's `tile({ layout: "google" })` writes files as <z>/<row>/<col>.jpg
  // (row = y, based on image height; col = x, based on image width) -
  // the reverse of the usual XYZ convention where the first path segment
  // is x. Confirmed empirically with a deliberately non-square test image.
  return fs.readFile(path.join(MAPS_DIR, mapId, "tiles", z, y, `${x}.jpg`));
}

export async function deleteMapAssets(map: {
  id: string;
  imagePath: string;
  renderMode: MapRow["renderMode"];
}): Promise<void> {
  if (map.renderMode === "tiled") {
    await fs.rm(path.join(MAPS_DIR, map.id), { recursive: true, force: true });
  } else {
    await deleteMapImage(map.imagePath);
  }
}
