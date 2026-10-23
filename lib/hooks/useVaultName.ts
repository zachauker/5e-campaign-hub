"use client";

import { useEffect, useState } from "react";

/**
 * The Obsidian vault's name (the `vault_name` setting), for building
 * `obsidian://` links. "" until it loads or when unset; `obsidianUri` treats ""
 * as "no vault name" and omits the param, so a link built early is still valid.
 */
export function useVaultName(): string {
  const [name, setName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, string>;
        if (!cancelled) setName(data.vault_name ?? "");
      } catch {
        // Leave it unset: the link still opens, in Obsidian's last-used vault.
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return name;
}
