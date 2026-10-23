"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, Map as MapIcon, type LucideIcon } from "lucide-react";
import { MarkdownBlocks } from "@/components/glossary/MarkdownBlocks";
import { PropsTable, type PropEntry } from "@/components/glossary/PropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { SimpleEntityFormDialog } from "@/components/entities/SimpleEntityFormDialog";
import { EntityThreadsBlock } from "@/components/state/EntityThreadsBlock";
import { BriefingCard, type BriefingCardData } from "@/components/run/BriefingCard";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useRunStore } from "@/lib/store/run-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useVaultName } from "@/lib/hooks/useVaultName";
import { useVaultPage } from "@/lib/hooks/useVaultPage";
import { obsidianUri } from "@/lib/vault/paths";

interface SimpleEntityDetailData {
  id: string;
  campaignId: string;
  name: string;
  description: string | null;
  type?: string | null;
  sourcePath: string | null;
  /** Only the edit form reads this; the page shows `sourcePath`. */
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
  mapMarkers?: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  sourceProps?: PropEntry[];
  linkedSessionNotes?: { id: string; name: string; noteType: string | null; date: string | null }[];
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
  const [hasThreadContent, setHasThreadContent] = useState(false);

  const vaultName = useVaultName();
  const { page, error: pageError, loading: pageLoading } = useVaultPage(entity?.sourcePath);

  const [briefing, setBriefing] = useState<BriefingCardData | null>(null);
  const [briefingStale, setBriefingStale] = useState(false);
  const [briefingThreads, setBriefingThreads] = useState<string[]>([]);
  const [buildingBriefing, setBuildingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  // Tracks whichever entity is actually on screen, readable from inside an
  // in-flight buildBriefing continuation. Mirrors AnswerPanel's selectedRef
  // (components/run/AnswerPanel.tsx, commit e192c76) — the app router reuses
  // this component across /{locations,items,factions}/[id] navigations (no
  // template.tsx), so a build's own closure over `id` is exactly the value
  // that must not decide where the result lands.
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentIdRef.current = id;
  }, [id]);

  // Keys the entities whose briefing build is currently in flight. Without
  // this, re-opening the same still-unbuilt entity before the first build
  // resolves fires a second concurrent build — the loser trips
  // entity_briefings' unique index, the route 400s, and a paid model call is
  // wasted for nothing shown. A ref because this must not cause a re-render
  // and must be cleared on both success and failure.
  const buildingIdsRef = useRef<Set<string>>(new Set());

  const pinned = useRunStore((s) => s.pinned);
  const pin = useRunStore((s) => s.pin);
  const unpin = useRunStore((s) => s.unpin);

  const targetKind = resourcePath.replace(/s$/, "") as "location" | "item" | "faction";

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

  const buildBriefing = useCallback(async () => {
    if (!activeCampaignId || !id) return;
    const targetId = id;
    if (buildingIdsRef.current.has(targetId)) return;
    buildingIdsRef.current.add(targetId);
    setBuildingBriefing(true);
    setBriefingError(null);
    try {
      const res = await fetch("/api/briefings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaignId, targetKind, targetId: id }),
      });
      if (res.ok) {
        const data: { briefing: BriefingCardData } = await res.json();
        // A build takes a model call, so the DM can easily navigate away
        // before it lands. Without this check the result is written into
        // whatever card is on screen now — one entity's briefing rendered
        // under another's name, read aloud at the table as if it were theirs.
        if (currentIdRef.current === targetId) {
          setBriefing(data.briefing);
          setBriefingStale(false);
        }
      } else if (currentIdRef.current === targetId) {
        setBriefingError("Briefing build failed. Try again.");
      }
    } catch {
      if (currentIdRef.current === targetId) setBriefingError("Briefing build failed. Try again.");
    } finally {
      buildingIdsRef.current.delete(targetId);
      setBuildingBriefing(false);
    }
  }, [activeCampaignId, targetKind, id]);

  // Fetches the briefing on first view and builds it lazily when absent. This
  // is a prep surface — /run never renders this component, so the round-trip
  // and the model call it can trigger are affordable here and nowhere else.
  useEffect(() => {
    if (!activeCampaignId || !id) return;
    let cancelled = false;
    fetch(`/api/briefings?campaignId=${activeCampaignId}&targetKind=${targetKind}&targetId=${id}`)
      .then((r) => (r.ok ? r.json() : { briefing: null, stale: false }))
      .then((data: { briefing: BriefingCardData | null; stale: boolean }) => {
        if (cancelled) return;
        setBriefing(data.briefing);
        setBriefingStale(data.stale);
        setBriefingError(null);
        if (!data.briefing) void buildBriefing();
      })
      .catch(() => {});

    fetch(`/api/threads?campaignId=${activeCampaignId}&targetKind=${targetKind}&targetId=${id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: { title: string }[] }) => {
        if (!cancelled) setBriefingThreads((data.items ?? []).map((t) => t.title));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeCampaignId, id, targetKind, buildBriefing]);

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
          <TabsTrigger value="note">Vault Note</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          <BriefingCard
            name={entity.name}
            briefing={briefing}
            fallback={{ description: entity.description, threads: briefingThreads }}
            stale={briefingStale}
            pinned={pinned.some((p) => p.targetId === entity.id)}
            onTogglePin={() =>
              pinned.some((p) => p.targetId === entity.id)
                ? unpin(entity.id)
                : pin({ kind: targetKind, targetId: entity.id, name: entity.name })
            }
            onBuild={buildBriefing}
            building={buildingBriefing}
          />
          {briefingError && (
            <p className="text-xs text-destructive">{briefingError}</p>
          )}

          {entity.description && (
            <p className="text-[15px] leading-relaxed text-foreground/85 max-w-[68ch]">
              {entity.description}
            </p>
          )}

          {entity.sourceProps && entity.sourceProps.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg">Properties</h3>
              <PropsTable props={entity.sourceProps} />
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

          <EntityThreadsBlock
            campaignId={entity.campaignId}
            targetKind={resourcePath.replace(/s$/, "") as "character" | "location" | "item" | "faction"}
            targetId={entity.id}
            onHasContentChange={setHasThreadContent}
          />

          {entity.linkedSessionNotes && entity.linkedSessionNotes.length > 0 && (
            <div className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Events here</h2>
              <ul className="space-y-1.5">
                {entity.linkedSessionNotes.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/sessions/${n.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-muted-foreground/40 transition-colors"
                    >
                      <span className="font-medium truncate">{n.name}</span>
                      <span className="flex-none text-xs text-muted-foreground">
                        {[n.noteType, n.date].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!entity.description &&
            (!entity.mapMarkers || entity.mapMarkers.length === 0) &&
            entity.linkedCharacters.length === 0 &&
            !hasThreadContent && (
              <p className="text-sm text-muted-foreground">No description or linked characters yet.</p>
            )}
        </TabsContent>

        <TabsContent value="note" className="pt-4">
          {!entity.sourcePath && (
            <p className="text-sm text-muted-foreground">No vault note linked.</p>
          )}
          {entity.sourcePath && pageLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading note...
            </div>
          )}
          {entity.sourcePath && pageError && <p className="text-sm text-destructive">{pageError}</p>}
          {entity.sourcePath && page && (
            <div className="space-y-3">
              <a
                href={obsidianUri(vaultName, entity.sourcePath)}
                className="text-xs text-primary hover:underline"
              >
                Open in Obsidian ↗
              </a>
              <MarkdownBlocks blocks={page.blocks} embeds={page.embeds} links={page.links} />
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
