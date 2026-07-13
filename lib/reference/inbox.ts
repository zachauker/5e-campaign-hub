import path from "path";
import fs from "fs";

const ALLOWED = new Set([".pdf", ".md", ".txt"]);

export function inboxDir(): string {
  return process.env.REFERENCE_INBOX_DIR || path.join(process.cwd(), "reference-inbox");
}

export function listInbox(): { name: string; sizeBytes: number }[] {
  const dir = inboxDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => ALLOWED.has(path.extname(name).toLowerCase()))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return st.isFile() ? { name, sizeBytes: st.size } : null;
    })
    .filter((f): f is { name: string; sizeBytes: number } => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a client-supplied filename to an absolute path, confined to the inbox dir. */
export function resolveInboxFile(name: string): string {
  const dir = path.resolve(inboxDir());
  if (name !== path.basename(name)) throw new Error("Invalid file name");
  if (!ALLOWED.has(path.extname(name).toLowerCase())) throw new Error("Unsupported file type");
  const full = path.resolve(dir, name);
  if (full !== path.join(dir, name) || !full.startsWith(dir + path.sep)) throw new Error("Invalid file path");
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("File not found");
  // Defense in depth: resolve symlinks and re-confirm containment (lexical checks
  // above don't catch a symlink inside the inbox pointing outside it).
  const realDir = fs.realpathSync(dir);
  const real = fs.realpathSync(full);
  if (real !== path.join(realDir, name) && !real.startsWith(realDir + path.sep)) throw new Error("Invalid file path");
  return full;
}
