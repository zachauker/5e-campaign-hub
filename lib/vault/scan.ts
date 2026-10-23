import fs from "fs";
import path from "path";
import { vaultRoot } from "./config";
import { parseFrontmatter } from "./frontmatter";

export interface VaultNote {
  /** Vault-relative, forward-slashed, including the `.md` extension. */
  path: string;
  /** File name without the `.md` extension. */
  basename: string;
  data: Record<string, unknown>;
  body: string;
}

/**
 * Directories never ingested, at any depth. Dot-directories hold stale backups
 * and tooling state (duplicates of real notes); `_Templates` carries real
 * `type:` frontmatter that would be mistaken for entities.
 */
function isExcludedDir(name: string): boolean {
  return name === "_Templates" || name.startsWith(".");
}

/**
 * Walk `folder` (an absolute campaign folder) and parse every `.md` file.
 * `root` is the vault root used to compute vault-relative note paths; it
 * defaults to the configured `VAULT_PATH`. A note that cannot be read or parsed
 * becomes a warning and the walk continues.
 */
export function scanVault(
  folder: string,
  root: string = vaultRoot(),
): { notes: VaultNote[]; warnings: string[] } {
  const notes: VaultNote[] = [];
  const warnings: string[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    // Sorted so scan output does not depend on filesystem enumeration order.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        try {
          const { data, body } = parseFrontmatter(fs.readFileSync(full, "utf8"));
          notes.push({ path: rel, basename: entry.name.slice(0, -".md".length), data, body });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          warnings.push(`Skipped ${rel}: ${reason}`);
        }
      }
    }
  };

  walk(folder);
  return { notes, warnings };
}
