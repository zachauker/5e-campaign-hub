import fs from "fs";
import os from "os";
import path from "path";

/**
 * Write a throwaway vault to a fresh temp directory and return its root.
 * Keys are vault-relative paths (intermediate directories are created);
 * values are file contents.
 */
export function createTestVault(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-vault-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return root;
}
