"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, Map as MapIcon, type LucideIcon } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { SimpleEntityFormDialog } from "@/components/entities/SimpleEntityFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { NotionBlockData } from "@/lib/notion/client";

interface SimpleEntityDetailData {
  id: string;
  name: string;
  description: string | null;
  type?: string | null;
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
  mapMarkers?: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  notionProps?: { label: string; value: string }[];
}

interface SimpleEntityDetailProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

// Shared with the list pages and the world-map markers.
const ACCENT: Record<SimpleEntityDetailProps["resourcePath"], string> = {
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

export function SimpleEntityDetail({ resourcePath, label, icon: Icon }: SimpleEntityDetailProps) {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [entity, setEntity] = useState<SimpleEntityDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const [notionBlocks, setNotionBlocks] = useState<NotionBlockData[] | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionLoading, setNotionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${resourcePath}/${id}`);
      setEntity(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [resourcePath, id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/${resourcePath}/${id}`);
        if (cancelled) return;
        setEntity(res.ok ? await res.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [resourcePath, id]);

  useEffect(() => {
    if (!entity?.notionUrl) return;
    let cancelled = false;
    async function run(url: string) {
      setNotionLoading(true);
      setNotionError(null);
      setNotionBlocks(null);
      try {
        const r = await fetch(`/api/notion/page?url=${encodeURIComponent(url)}`);
        const data = await r.json();
        if (cancelled) return;
        if (data.error) setNotionError(data.error);
        else setNotionBlocks(data.blocks);
      } catch {
        if (!cancelled) setNotionError("Failed to fetch Notion page");
      } finally {
        if (!cancelled) setNotionLoading(false);
      }
    }
    run(entity.notionUrl);
    return () => {
      cancelled = true;
    };
  }, [entity?.notionUrl]);

  async function remove() {
    const ok = await confirm({
      title: `Delete ${label.toLowerCase().replace(/s$/, "")}?`,
      description: "This permanently removes it from the campaign.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    router.push(`/${resourcePath}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">{label.replace(/s$/, "")} not found.</p>
        <Button onClick={() => router.push(`/${resourcePath}`)}>Back to {label}</Button>
      </div>
    );
  }

  const LOCATION_TYPE_LABELS: Record<string, string> = {
    city: "City",
    town: "Town",
    poi: "Point of Interest",
    region: "Region",
    other: "Other",
  };

  const accent = ACCENT[resourcePath];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link
        href={`/${resourcePath}`}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {label}
      </Link>

      <header className="mt-5 flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <Icon className="w-7 h-7 flex-none" style={{ color: accent }} />
            <h1 className="font-display text-4xl leading-none">{entity.name}</h1>
          </div>
          {resourcePath === "locations" && entity.type && (
            <span
              className="inline-flex mt-3 items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ color: accent, backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)` }}
            >
              {LOCATION_TYPE_LABELS[entity.type] ?? entity.type}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-none">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </header>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notion">Notion Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          {entity.description && (
            <p className="text-[15px] leading-relaxed text-foreground/85 max-w-[68ch]">
              {entity.description}
            </p>
          )}

          {entity.notionProps && entity.notionProps.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg">Notion properties</h3>
              <NotionPropsTable props={entity.notionProps} />
            </div>
          )}

          {entity.mapMarkers && entity.mapMarkers.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-lg">On the map</h3>
              <div className="flex flex-wrap gap-2">
                {entity.mapMarkers.map((m) => (
                  <Link
                    key={m.markerId}
                    href={m.renderMode === "world" ? `/world#marker-${m.markerId}` : `/maps/${m.mapId}#marker-${m.markerId}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors text-sm"
                  >
                    <MapIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{m.mapName}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {entity.linkedCharacters.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-lg">Linked characters</h3>
              <div className="flex flex-wrap gap-2">
                {entity.linkedCharacters.map((c) => (
                  <RelatedCard
                    key={c.id}
                    href={`/characters/${c.id}`}
                    name={c.name}
                    type={c.type === "pc" ? "PC" : "NPC"}
                  />
                ))}
              </div>
            </div>
          )}

          {!entity.description && (!entity.mapMarkers || entity.mapMarkers.length === 0) && entity.linkedCharacters.length === 0 && (
            <p className="text-sm text-muted-foreground">No description or linked characters yet.</p>
          )}
        </TabsContent>

        <TabsContent value="notion" className="pt-4">
          {!entity.notionUrl && (
            <p className="text-sm text-muted-foreground">No Notion page linked. Add one via Edit.</p>
          )}
          {entity.notionUrl && notionLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Notion page...
            </div>
          )}
          {entity.notionUrl && notionError && <p className="text-sm text-destructive">{notionError}</p>}
          {entity.notionUrl && notionBlocks && (
            <div className="space-y-3">
              <a
                href={entity.notionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                View in Notion ↗
              </a>
              <NotionBlocks blocks={notionBlocks} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SimpleEntityFormDialog
        key={entity.id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={entity}
        onSaved={load}
      />
    </div>
  );
}
