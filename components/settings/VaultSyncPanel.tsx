"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { describeSyncFailure, parseSyncStatus, type SyncStatusView } from "@/lib/vault/sync-status";

interface SourceRow {
  rootPath: string;
  lastSyncedAt?: string | number | null;
  lastStatus?: string | null;
}

/** lastSyncedAt comes from a Drizzle sqlite timestamp column; it reaches the
 * client as an ISO string, but handle raw epoch seconds too and never show
 * "Invalid Date". */
function formatSyncedAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function VaultSyncPanel({ campaignId }: { campaignId: string | null }) {
  const toast = useToast();
  const [source, setSource] = useState<SourceRow | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [savedVaultName, setSavedVaultName] = useState("");
  const [status, setStatus] = useState<SyncStatusView>({ kind: "never" });
  const [syncing, setSyncing] = useState(false);
  const [savingPath, setSavingPath] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [savingAuto, setSavingAuto] = useState(false);

  function applySource(row: SourceRow | null) {
    setSource(row);
    setRootPath(row?.rootPath ?? "");
    setStatus(parseSyncStatus(row?.lastStatus));
  }

  async function reloadSource() {
    if (!campaignId) return;
    const r = await fetch(`/api/vault/source?campaignId=${encodeURIComponent(campaignId)}`);
    const data = await r.json();
    applySource((data.source as SourceRow | null) ?? null);
  }

  // Load on mount / campaign change with a cancellation guard so a stale
  // response can't set state after the effect is torn down.
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/vault/source?campaignId=${encodeURIComponent(campaignId)}`);
        const data = await r.json();
        if (cancelled) return;
        applySource((data.source as SourceRow | null) ?? null);
      } catch {
        // Leave the panel empty; saving or syncing will surface a real error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  // Global settings: vault name and auto-sync config (the settings table, not per-source).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        if (cancelled) return;
        const name = data.vault_name ?? "";
        setVaultName(name);
        setSavedVaultName(name);
        // The legacy notion_* keys are what an upgraded install still has until
        // the DM changes the control, and the scheduler falls back to them too.
        const enabled = data.vault_auto_sync_enabled ?? data.notion_auto_sync_enabled;
        setAutoEnabled(enabled !== "false");
        const n = Number.parseInt(
          data.vault_auto_sync_interval_minutes ?? data.notion_auto_sync_interval_minutes ?? "",
          10,
        );
        setIntervalMinutes(Number.isFinite(n) && n >= 1 ? n : 15);
      } catch {
        // Defaults stand.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveRootPath() {
    if (!campaignId) return;
    setSavingPath(true);
    setPathError(null);
    try {
      const res = await fetch("/api/vault/source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, rootPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPathError(data.error ?? "Could not save the vault folder");
        return;
      }
      await reloadSource();
    } catch {
      setPathError("Could not save the vault folder — check your connection and try again.");
    } finally {
      setSavingPath(false);
    }
  }

  async function saveVaultName() {
    const next = vaultName.trim();
    setSavingName(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault_name: next }),
      });
      if (!res.ok) {
        toast({ title: "Could not save the vault name", variant: "error" });
        return;
      }
      setVaultName(next);
      setSavedVaultName(next);
    } finally {
      setSavingName(false);
    }
  }

  async function syncNow() {
    if (!campaignId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/vault/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(describeSyncFailure(res.status, data.error));
        // A 503 also wrote { error } to last_status; reload so it shows below.
        await reloadSource();
        return;
      }
      setStatus(parseSyncStatus(data.summary));
      await reloadSource();
    } catch {
      setSyncError("Sync failed — check your connection and try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function saveAutoSync(next: { enabled?: boolean; interval?: number }) {
    const enabled = next.enabled ?? autoEnabled;
    const interval = next.interval ?? intervalMinutes;
    setAutoEnabled(enabled);
    setIntervalMinutes(interval);
    setSavingAuto(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault_auto_sync_enabled: enabled ? "true" : "false",
          vault_auto_sync_interval_minutes: String(interval),
        }),
      });
      if (!res.ok) toast({ title: "Could not save auto-sync settings", variant: "error" });
    } finally {
      setSavingAuto(false);
    }
  }

  if (!campaignId) return null;

  const syncedAt = formatSyncedAt(source?.lastSyncedAt);
  const pathDirty = rootPath.trim() !== (source?.rootPath ?? "");

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Obsidian Vault</h2>
        <Button onClick={syncNow} disabled={syncing || !source || pathDirty} className="gap-1.5 flex-none">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        The hub reads your campaign folder from the vault mounted into the server. It never writes to it.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="vault-root-path" className="text-sm text-muted-foreground block mb-1.5">
          Campaign folder
        </label>
        <div className="flex gap-2">
          <Input
            id="vault-root-path"
            value={rootPath}
            placeholder="D&D/Explorers of Exandria"
            onChange={(e) => { setRootPath(e.target.value); setPathError(null); }}
            onKeyDown={(e) => e.key === "Enter" && pathDirty && saveRootPath()}
            className="flex-1"
          />
          <Button variant="outline" onClick={saveRootPath} disabled={savingPath || !pathDirty} className="flex-none">
            {savingPath ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Relative to the vault root, not an absolute path. Clear the field and save to disconnect.
        </p>
        {pathError && <p role="alert" className="text-sm text-destructive">{pathError}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="vault-name" className="text-sm text-muted-foreground block mb-1.5">
          Vault name
        </label>
        <div className="flex gap-2">
          <Input
            id="vault-name"
            value={vaultName}
            placeholder="Obsidian vault name"
            onChange={(e) => setVaultName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && vaultName.trim() !== savedVaultName && saveVaultName()}
            className="flex-1"
          />
          <Button
            variant="outline"
            onClick={saveVaultName}
            disabled={savingName || vaultName.trim() === savedVaultName}
            className="flex-none"
          >
            {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The name Obsidian knows the vault by; used for &ldquo;Open in Obsidian&rdquo; links.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <label htmlFor="auto-sync-toggle" className="text-sm font-medium">Automatic background sync</label>
          <p className="text-xs text-muted-foreground">
            Keeps this app up to date with the vault on a schedule. Manual sync stays available anytime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="auto-sync-interval"
            aria-label="Auto-sync interval"
            value={intervalMinutes}
            disabled={!autoEnabled || savingAuto}
            onChange={(e) => saveAutoSync({ interval: Number(e.target.value) })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
          >
            <option value={5}>Every 5 min</option>
            <option value={15}>Every 15 min</option>
            <option value={30}>Every 30 min</option>
            <option value={60}>Every 60 min</option>
          </select>
          <input
            id="auto-sync-toggle"
            type="checkbox"
            checked={autoEnabled}
            disabled={savingAuto}
            onChange={(e) => saveAutoSync({ enabled: e.target.checked })}
            className="h-5 w-5 accent-primary"
          />
        </div>
      </div>

      {/* Sync result */}
      <div className="space-y-3" aria-live="polite">
        {syncError && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
            {syncError}
          </p>
        )}

        {!source && status.kind === "never" && (
          <p className="text-sm text-muted-foreground">
            No folder set. Enter the path to this campaign&apos;s folder above, save, then sync.
          </p>
        )}
        {source && status.kind === "never" && (
          <p className="text-sm text-muted-foreground">Not synced yet. Press Sync now to read this folder.</p>
        )}

        {status.kind === "error" && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
            <p className="flex items-center gap-1.5 font-medium text-destructive">
              <AlertTriangle className="w-4 h-4 flex-none" /> The last sync failed
            </p>
            <p className="text-muted-foreground break-words">{status.message}</p>
            {syncedAt && <p className="text-xs text-muted-foreground">Attempted {syncedAt}</p>}
          </div>
        )}

        {status.kind === "unrecognised" && (
          <p className="text-sm text-muted-foreground">
            The last sync result couldn&apos;t be read. Press Sync now to refresh it.
          </p>
        )}

        {status.kind === "ok" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--hp-high)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Folder found
              {syncedAt && <span className="text-muted-foreground">· last synced {syncedAt}</span>}
            </p>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th scope="col" className="px-3 py-2 font-normal">Section</th>
                    <th scope="col" className="px-2 py-2 font-normal text-right">New</th>
                    <th scope="col" className="px-2 py-2 font-normal text-right">Updated</th>
                    <th scope="col" className="px-2 py-2 font-normal text-right">Unchanged</th>
                    <th scope="col" className="px-2 py-2 font-normal text-right">Archived</th>
                    <th scope="col" className="px-3 py-2 font-normal text-right">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {status.tables.map((t) => (
                    <React.Fragment key={t.table}>
                      <tr className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-3 py-2 font-normal text-left">{t.label}</th>
                        <td className="px-2 py-2 text-right tabular-nums">{t.created}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{t.updated + t.adopted}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{t.unchanged}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{t.archived}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.skipped}</td>
                      </tr>
                      {t.error && (
                        <tr className="border-b border-border last:border-b-0">
                          <td colSpan={6} className="px-3 py-2 text-xs text-destructive break-words">
                            {t.label}: {t.error}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {status.campaignSkipped > 0 && (
              <p className="text-xs text-muted-foreground">
                {status.campaignSkipped} other note{status.campaignSkipped === 1 ? "" : "s"} in the folder
                {status.campaignSkipped === 1 ? " was" : " were"} read but not mirrored anywhere.
              </p>
            )}
            {status.warnings.length > 0 && (
              <div className={cn("rounded-lg border border-border bg-muted/30 p-3 space-y-1")}>
                <p className="text-xs font-medium">
                  {status.warnings.length} warning{status.warnings.length === 1 ? "" : "s"}
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-xs text-muted-foreground">
                  {status.warnings.map((w) => (
                    <li key={w} className="break-words">{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
