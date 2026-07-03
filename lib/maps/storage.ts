import fs from "fs/promises";
import path from "path";

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
