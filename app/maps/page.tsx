"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Map as MapIcon, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UploadMapDialog } from "@/components/maps/UploadMapDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

interface MapListItem {
  id: string;
  name: string;
}

export default function MapsPage() {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const toast = useToast();
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renaming, setRenaming] = useState<MapListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/maps?campaignId=${activeCampaignId}`).then((res) => {
      if (res.ok) res.json().then(setMaps);
    });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  function openRename(m: MapListItem) {
    setRenaming(m);
    setRenameValue(m.name);
  }

  async function submitRename() {
    const name = renameValue.trim();
    if (!renaming || !name) return;
    setRenameSaving(true);
    try {
      await fetch(`/api/maps/${renaming.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setRenaming(null);
      load();
    } finally {
      setRenameSaving(false);
    }
  }

  async function removeMap(m: MapListItem) {
    const ok = await confirm({
      title: `Delete “${m.name}”?`,
      description: "This permanently deletes the map and its image.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/maps/${m.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({
        title: "Couldn’t delete map",
        description: data.error ?? "Please try again.",
        variant: "error",
      });
      return;
    }
    load();
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <MapIcon className="w-7 h-7 flex-none text-[var(--marker-submap)]" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">Maps</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{maps.length}</span>{" "}
              {maps.length === 1 ? "map" : "maps"} in this campaign
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5 flex-none">
          <Plus className="w-3.5 h-3.5" /> Upload map
        </Button>
      </header>

      {maps.length === 0 ? (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground">
          No maps yet. Upload one to get started.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {maps.map((m) => (
            <div
              key={m.id}
              className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors"
            >
              <div className="aspect-video bg-muted overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map thumbnail */}
                <img
                  src={`/api/maps/${m.id}/image`}
                  alt={m.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="px-3 py-2 text-sm font-medium truncate">{m.name}</div>

              {/* Stretched link over static content; hover controls sit above it */}
              <Link
                href={`/maps/${m.id}`}
                aria-label={`Open map: ${m.name}`}
                className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  onClick={() => openRename(m)}
                  aria-label={`Rename ${m.name}`}
                  title="Rename"
                  className="rounded-md border border-border bg-background/85 backdrop-blur-sm p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => removeMap(m)}
                  aria-label={`Delete ${m.name}`}
                  title="Delete"
                  className="rounded-md border border-border bg-background/85 backdrop-blur-sm p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadMapDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={activeCampaignId ?? ""}
        onUploaded={load}
      />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename map</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            placeholder="Map name"
            aria-label="Map name"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={renameSaving || !renameValue.trim()}>
              {renameSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
