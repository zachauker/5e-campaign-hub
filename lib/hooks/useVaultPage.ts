"use client";

import { useEffect, useState } from "react";
import { vaultPageUrl } from "@/lib/vault/paths";
import type { VaultPage } from "@/lib/vault/page";

interface Settled {
  /** The path this result is for, so a result for a previous note is never shown. */
  path: string;
  page: VaultPage | null;
  error: string | null;
}

/**
 * Fetch and hold a note's rendered blocks and resolved embeds from
 * `/api/vault/page`. `sourcePath` of `null`/`undefined` means "no note linked":
 * nothing is fetched and `loading` is false. Cancellation-guarded, and `loading`
 * is derived (a path with no settled result yet) rather than set in the effect.
 */
export function useVaultPage(sourcePath: string | null | undefined) {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!sourcePath) return;
    let cancelled = false;
    async function run(path: string) {
      let next: Omit<Settled, "path">;
      try {
        const res = await fetch(vaultPageUrl(path));
        const data = await res.json();
        next = res.ok
          ? { page: data as VaultPage, error: null }
          : { page: null, error: (data as { error?: string }).error ?? "Couldn't load the note." };
      } catch {
        next = { page: null, error: "Couldn't load the note." };
      }
      if (!cancelled) setSettled({ path, ...next });
    }
    run(sourcePath);
    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  const current = sourcePath && settled?.path === sourcePath ? settled : null;
  return {
    page: current?.page ?? null,
    error: current?.error ?? null,
    loading: Boolean(sourcePath) && current === null,
  };
}
