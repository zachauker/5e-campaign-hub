import fs from "fs";
import path from "path";

export class VaultUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultUnreadableError";
  }
}

/** Where the vault is mounted in the container. Read at call time, not import time. */
export function vaultRoot(): string {
  return process.env.VAULT_PATH || "/vault";
}

/**
 * Absolute path of a campaign's folder: the mount point joined with the
 * vault-relative `rootPath` stored on `vault_sources`.
 */
export function resolveCampaignFolder(rootPath: string): string {
  const folder = path.join(vaultRoot(), rootPath);
  try {
    if (!fs.statSync(folder).isDirectory()) {
      throw new VaultUnreadableError(`Vault path is not a directory: ${folder}`);
    }
    fs.accessSync(folder, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    if (err instanceof VaultUnreadableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new VaultUnreadableError(`Vault path is not readable: ${folder} (${reason})`);
  }
  return folder;
}
