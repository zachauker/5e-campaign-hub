"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, Map as MapIcon, type LucideIcon } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { SimpleEntityFormDialog } from "@/components/entities/SimpleEntityFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { NotionBlockData } from "@/lib/notion/client";

interface SimpleEntityDetailData {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
  mapMarkers?: { mapId: string; mapName: string; markerId: string }[];
}

interface SimpleEntityDetailProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

export function SimpleEntityDetail({ resourcePath, label, icon: Icon }: SimpleEntityDetailProps) {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
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
    if (!confirm(`Delete this ${label.toLowerCase().replace(/s$/, "")}?`)) return;
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <Link
        href={`/${resourcePath}`}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {label}
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" /> {entity.name}
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notion">Notion Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {entity.description && <p className="text-sm text-muted-foreground">{entity.description}</p>}

          {entity.mapMarkers && entity.mapMarkers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On the Map</h3>
              <div className="flex flex-wrap gap-2">
                {entity.mapMarkers.map((m) => (
                  <Link
                    key={m.markerId}
                    href={`/maps/${m.mapId}`}
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linked Characters
              </h3>
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
