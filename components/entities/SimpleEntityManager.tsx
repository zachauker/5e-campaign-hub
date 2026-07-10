"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SimpleEntityFormDialog, type SimpleEntity } from "@/components/entities/SimpleEntityFormDialog";

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

// Each section carries its own identity color, shared with the world-map markers.
const ACCENT: Record<SimpleEntityManagerProps["resourcePath"], string> = {
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

// Locations have no `archived` column (unlike items/factions), so the API for that
// resource still returns a bare array and has no archived-toggle support.
const SUPPORTS_ARCHIVED: Record<SimpleEntityManagerProps["resourcePath"], boolean> = {
  locations: false,
  items: true,
  factions: true,
};

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [entities, setEntities] = useState<SimpleEntity[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const supportsArchived = SUPPORTS_ARCHIVED[resourcePath];

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    const url = `/api/${resourcePath}?campaignId=${activeCampaignId}${
      supportsArchived && showArchived ? "&includeArchived=1" : ""
    }`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (supportsArchived) {
          setEntities(data.items);
          setArchivedCount(data.archivedCount);
        } else {
          setEntities(data);
        }
      });
  }, [activeCampaignId, resourcePath, supportsArchived, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const singular = label.toLowerCase().replace(/s$/, "");
  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: `Delete ${singular}?`,
      description: "This permanently removes it from the campaign.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    setEntities((prev) => prev.filter((x) => x.id !== id));
  }

  const filtered = entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()));
  const accent = ACCENT[resourcePath];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Journal-style header: serif title, entity accent, a real count */}
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Icon className="w-7 h-7 flex-none" style={{ color: accent }} />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">{label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{entities.length}</span>{" "}
              {entities.length === 1 ? singular : label.toLowerCase()} across Exandria
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {supportsArchived && archivedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 flex-none">
            <Plus className="w-4 h-4" /> New {singular}
          </Button>
        </div>
      </header>

      <Input
        className="mt-6"
        placeholder={`Search ${label.toLowerCase()}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground">
          {entities.length === 0 ? `No ${label.toLowerCase()} yet.` : "Nothing matches that search."}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-border/60">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group"
            >
              {/* Stretched link keeps the whole row a keyboard-focusable nav target */}
              <Link
                href={`/${resourcePath}/${e.id}`}
                aria-label={`Open ${singular}: ${e.name}`}
                className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
              <span
                className="w-1.5 h-1.5 rounded-full flex-none"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                {e.description && (
                  <p className="text-[13px] text-muted-foreground truncate mt-0.5">{e.description}</p>
                )}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${singular}: ${e.name}`}
                className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                onClick={(ev) => remove(e.id, ev)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <SimpleEntityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={null}
        onSaved={load}
      />
    </div>
  );
}
