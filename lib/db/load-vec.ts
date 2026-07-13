import type DatabaseType from "better-sqlite3";
import fs from "fs";
import path from "path";
import { arch, platform } from "process";
import * as sqliteVec from "sqlite-vec";

/**
 * Resolve the sqlite-vec loadable extension (vec0.{so,dylib,dll}) by filesystem path.
 *
 * sqlite-vec's own `load()` calls `require.resolve("sqlite-vec-<os>-<arch>/vec0.<ext>")`,
 * which fails inside the Next.js standalone bundle — the bundled runtime can't
 * require-resolve a native file in node_modules (the same class of problem as sharp's
 * libvips). We compute the path from cwd/node_modules instead, which the Dockerfile
 * overlays into the runtime image, so it resolves in both bundled (prod) and plain
 * (dev / tsx scripts) contexts.
 */
function vecExtensionPath(): string | null {
  const os = platform === "win32" ? "windows" : platform;
  const ext = platform === "win32" ? "dll" : platform === "darwin" ? "dylib" : "so";
  const p = path.join(process.cwd(), "node_modules", `sqlite-vec-${os}-${arch}`, `vec0.${ext}`);
  return fs.existsSync(p) ? p : null;
}

/**
 * Load the sqlite-vec extension into a better-sqlite3 Database.
 * Returns true on success, false if unavailable (prod must degrade, not crash).
 */
export function loadVec(sqlite: DatabaseType.Database): boolean {
  try {
    const p = vecExtensionPath();
    if (p) {
      // better-sqlite3 derives the entry point from the filename (vec0 -> sqlite3_vec0_init).
      sqlite.loadExtension(p);
    } else {
      // Fallback (unusual cwd): let sqlite-vec resolve it itself.
      sqliteVec.load(sqlite);
    }
    return true;
  } catch {
    return false;
  }
}
