"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/toast";

const SOURCES = [
  { type: "characters", label: "Characters" },
  { type: "items", label: "Items & Loot" },
  { type: "factions", label: "Factions & Organizations" },
] as const;

interface SourceState {
  databaseUrl?: string;
  lastSyncedAt?: string | number | null;
}

/** lastSyncedAt comes from a Drizzle sqlite integer timestamp column. On the
 * server it deserializes to a Date; NextResponse.json() then stringifies it
 * to an ISO string, so the client normally sees a string. Handle a raw
 * numeric (epoch seconds) value defensively too, and never show "Invalid Date". */
function formatSyncedAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function NotionSyncPanel({ campaignId }: { campaignId: string | null }) {
  const toast = useToast();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, SourceState>>({});
  const [syncing, setSyncing] = useState(false);
  const [savingType, setSavingType] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const r = await fetch(`/api/notion/sources?campaignId=${campaignId}`);
    const data = await r.json();
    const m: Record<string, SourceState> = data.sources ?? {};
    setMeta(m);
    setUrls(Object.fromEntries(SOURCES.map((s) => [s.type, m[s.type]?.databaseUrl ?? ""])));
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSource(type: string) {
    if (!campaignId) return;
    setSavingType(type);
    try {
      const res = await fetch("/api/notion/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, entityType: type, databaseUrl: urls[type] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Could not save", variant: "error" });
      } else {
        await load();
      }
    } finally {
      setSavingType(null);
    }
  }

  async function syncNow() {
    if (!campaignId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/notion/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Sync failed", variant: "error" });
        return;
      }
      const s = data.summary as Record<
        string,
        { created: number; updated: number; adopted: number; archived: number; error?: string }
      >;
      const parts = Object.entries(s).map(([t, v]) =>
        v.error ? `${t}: ${v.error}` : `${t}: +${v.created} ~${v.updated + v.adopted} archived ${v.archived}`
      );
      toast({ title: "Sync complete", description: parts.join(" · "), variant: "success" });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  if (!campaignId) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Notion Sync</h2>
        <Button onClick={syncNow} disabled={syncing} className="gap-1.5 flex-none">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste each database&apos;s Notion URL. Share each database with your integration first.
      </p>
      {SOURCES.map((s) => (
        <div key={s.type} className="space-y-1.5">
          <label className="text-sm text-muted-foreground block mb-1.5">{s.label}</label>
          <div className="flex gap-2">
            <Input
              value={urls[s.type] ?? ""}
              placeholder="https://www.notion.so/…"
              onChange={(e) => setUrls((u) => ({ ...u, [s.type]: e.target.value }))}
              className="flex-1"
            />
            <Button variant="outline" onClick={() => saveSource(s.type)} disabled={savingType === s.type} className="flex-none">
              {savingType === s.type ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
          {formatSyncedAt(meta[s.type]?.lastSyncedAt) && (
            <p className="text-xs text-muted-foreground">Last synced {formatSyncedAt(meta[s.type]?.lastSyncedAt)}</p>
          )}
        </div>
      ))}
    </section>
  );
}
