// app/characters/[id]/page.tsx
"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, Map as MapIcon, UserRound } from "lucide-react";
import { MarkdownBlocks } from "@/components/glossary/MarkdownBlocks";
import { PropsTable } from "@/components/glossary/PropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { StatBlock } from "@/components/tracker/StatBlock";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import { EntityThreadsBlock } from "@/components/state/EntityThreadsBlock";
import { BriefingCard, type BriefingCardData } from "@/components/run/BriefingCard";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useRunStore } from "@/lib/store/run-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ddbCharacterToStatBlock } from "@/lib/ddb/client";
import { useVaultName } from "@/lib/hooks/useVaultName";
import { useVaultPage } from "@/lib/hooks/useVaultPage";
import { obsidianUri } from "@/lib/vault/paths";
import type { StatBlock as StatBlockType, DDBCharacter } from "@/lib/types";

interface RelatedEntity {
  id: string;
  name: string;
}

export default function CharacterDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [character, setCharacter] = useState<CharacterWithLinks | null>(null);
  const [factions, setFactions] = useState<RelatedEntity[]>([]);
  const [locations, setLocations] = useState<RelatedEntity[]>([]);
  const [items, setItems] = useState<RelatedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [hasThreadContent, setHasThreadContent] = useState(false);

  const vaultName = useVaultName();
  const { page, error: pageError, loading: pageLoading } = useVaultPage(character?.sourcePath);

  const [ddbCharacter, setDdbCharacter] = useState<DDBCharacter | null>(null);
  const [ddbError, setDdbError] = useState<string | null>(null);
  const [ddbLoading, setDdbLoading] = useState(false);

  const [briefing, setBriefing] = useState<BriefingCardData | null>(null);
  const [briefingStale, setBriefingStale] = useState(false);
  const [briefingThreads, setBriefingThreads] = useState<string[]>([]);
  const [buildingBriefing, setBuildingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  // Tracks whichever character is actually on screen, readable from inside an
  // in-flight buildBriefing continuation. Mirrors AnswerPanel's selectedRef
  // (components/run/AnswerPanel.tsx, commit e192c76) — the app router reuses
  // this page component across /characters/[id] navigations (no
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

  // Used by CharacterFormDialog's onSaved callback (an event-handler context,
  // not an effect — synchronous setLoading(true) here is fine and doesn't
  // trip react-hooks/set-state-in-effect, which only flags effect bodies).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/characters/${id}`);
      if (!res.ok) {
        setCharacter(null);
        return;
      }
      const data: CharacterWithLinks = await res.json();
      setCharacter(data);

      const [f, l, i] = await Promise.all([
        Promise.all(data.factionIds.map((fid) => fetch(`/api/factions/${fid}`).then((r) => r.json()))),
        Promise.all(data.locationIds.map((lid) => fetch(`/api/locations/${lid}`).then((r) => r.json()))),
        Promise.all(data.itemIds.map((iid) => fetch(`/api/items/${iid}`).then((r) => r.json()))),
      ]);
      setFactions(f);
      setLocations(l);
      setItems(i);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Mount / id-change effect — deliberately duplicates load()'s body inside a
  // cancellation-guarded named function rather than calling load() directly,
  // matching the pattern established in Task 9 (components/glossary/SimpleEntityDetail.tsx).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/characters/${id}`);
        if (cancelled) return;
        if (!res.ok) {
          setCharacter(null);
          return;
        }
        const data: CharacterWithLinks = await res.json();
        if (cancelled) return;
        setCharacter(data);

        const [f, l, i] = await Promise.all([
          Promise.all(data.factionIds.map((fid) => fetch(`/api/factions/${fid}`).then((r) => r.json()))),
          Promise.all(data.locationIds.map((lid) => fetch(`/api/locations/${lid}`).then((r) => r.json()))),
          Promise.all(data.itemIds.map((iid) => fetch(`/api/items/${iid}`).then((r) => r.json()))),
        ]);
        if (cancelled) return;
        setFactions(f);
        setLocations(l);
        setItems(i);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!character?.ddbCharacterId) return;
    let cancelled = false;
    async function run(ddbId: string) {
      setDdbLoading(true);
      setDdbError(null);
      setDdbCharacter(null);
      try {
        const r = await fetch(`/api/ddb/characters/${ddbId}`);
        const data = await r.json();
        if (cancelled) return;
        if (data.error) setDdbError(data.error);
        else setDdbCharacter(data.character);
      } catch {
        if (!cancelled) setDdbError("Failed to fetch D&D Beyond character");
      } finally {
        if (!cancelled) setDdbLoading(false);
      }
    }
    run(character.ddbCharacterId);
    return () => {
      cancelled = true;
    };
  }, [character?.ddbCharacterId]);

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
        body: JSON.stringify({ campaignId: activeCampaignId, targetKind: "character", targetId: id }),
      });
      if (res.ok) {
        const data: { briefing: BriefingCardData } = await res.json();
        // A build takes a model call, so the DM can easily navigate away
        // before it lands. Without this check the result is written into
        // whatever card is on screen now — one NPC's briefing rendered under
        // another's name, read aloud at the table as if it were theirs.
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
  }, [activeCampaignId, id]);

  // Fetches the briefing on first view and builds it lazily when absent. This
  // is a prep surface — /run never renders this page, so the round-trip and
  // the model call it can trigger are affordable here and nowhere else.
  useEffect(() => {
    if (!activeCampaignId || !id) return;
    let cancelled = false;
    fetch(`/api/briefings?campaignId=${activeCampaignId}&targetKind=character&targetId=${id}`)
      .then((r) => (r.ok ? r.json() : { briefing: null, stale: false }))
      .then((data: { briefing: BriefingCardData | null; stale: boolean }) => {
        if (cancelled) return;
        setBriefing(data.briefing);
        setBriefingStale(data.stale);
        setBriefingError(null);
        if (!data.briefing) void buildBriefing();
      })
      .catch(() => {});

    fetch(`/api/threads?campaignId=${activeCampaignId}&targetKind=character&targetId=${id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: { title: string }[] }) => {
        if (!cancelled) setBriefingThreads((data.items ?? []).map((t) => t.title));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeCampaignId, id, buildBriefing]);

  async function remove() {
    const ok = await confirm({
      title: "Delete character?",
      description: "This permanently removes the character from the campaign.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    router.push("/characters");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Character not found.</p>
        <Button onClick={() => router.push("/characters")}>Back to Characters</Button>
      </div>
    );
  }

  const ddbStatBlock: StatBlockType | null = ddbCharacter ? ddbCharacterToStatBlock(ddbCharacter) : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link
        href="/characters"
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Characters
      </Link>

      <header className="mt-5 flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <UserRound className="w-7 h-7 flex-none text-[var(--marker-character)]" />
            <h1 className="font-display text-4xl leading-none">{character.name}</h1>
          </div>
          <Badge
            variant={character.type === "pc" ? "hp" : "outline"}
            className="capitalize mt-3"
          >
            {character.type}
          </Badge>
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
          <TabsTrigger value="ddb">D&D Beyond</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          <BriefingCard
            name={character.name}
            briefing={briefing}
            fallback={{ description: character.description, threads: briefingThreads }}
            stale={briefingStale}
            pinned={pinned.some((p) => p.targetId === character.id)}
            onTogglePin={() =>
              pinned.some((p) => p.targetId === character.id)
                ? unpin(character.id)
                : pin({ kind: "character", targetId: character.id, name: character.name })
            }
            onBuild={buildBriefing}
            building={buildingBriefing}
          />
          {briefingError && (
            <p className="text-xs text-destructive">{briefingError}</p>
          )}

          {character.description && (
            <p className="text-[15px] leading-relaxed text-foreground/85 max-w-[68ch]">
              {character.description}
            </p>
          )}

          {character.sourceProps && character.sourceProps.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg">Properties</h3>
              <PropsTable props={character.sourceProps} />
            </div>
          )}

          {character.mapMarkers.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-lg">On the map</h3>
              <div className="flex flex-wrap gap-2">
                {character.mapMarkers.map((m) => (
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

          {(factions.length > 0 || locations.length > 0 || items.length > 0) && (
            <div className="space-y-3">
              <h3 className="font-display text-lg">Related</h3>
              <div className="flex flex-wrap gap-2">
                {factions.map((f) => (
                  <RelatedCard key={f.id} href={`/factions/${f.id}`} name={f.name} type="Faction" />
                ))}
                {locations.map((l) => (
                  <RelatedCard key={l.id} href={`/locations/${l.id}`} name={l.name} type="Location" />
                ))}
                {items.map((i) => (
                  <RelatedCard key={i.id} href={`/items/${i.id}`} name={i.name} type="Item" />
                ))}
              </div>
            </div>
          )}

          <EntityThreadsBlock
            campaignId={character.campaignId}
            targetKind="character"
            targetId={character.id}
            onHasContentChange={setHasThreadContent}
          />

          {!character.description &&
            character.mapMarkers.length === 0 &&
            factions.length === 0 &&
            locations.length === 0 &&
            items.length === 0 &&
            !hasThreadContent && (
              <p className="text-sm text-muted-foreground">No description or relationships yet.</p>
            )}
        </TabsContent>

        <TabsContent value="note" className="pt-4">
          {!character.sourcePath && (
            <p className="text-sm text-muted-foreground">No vault note linked.</p>
          )}
          {character.sourcePath && pageLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading note...
            </div>
          )}
          {character.sourcePath && pageError && <p className="text-sm text-destructive">{pageError}</p>}
          {character.sourcePath && page && (
            <div className="space-y-3">
              <a
                href={obsidianUri(vaultName, character.sourcePath)}
                className="text-xs text-primary hover:underline"
              >
                Open in Obsidian ↗
              </a>
              <MarkdownBlocks blocks={page.blocks} embeds={page.embeds} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="ddb" className="pt-4">
          {!character.ddbCharacterId && (
            <p className="text-sm text-muted-foreground">No D&D Beyond character linked. Add one via Edit.</p>
          )}
          {character.ddbCharacterId && ddbLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading D&D Beyond stats...
            </div>
          )}
          {character.ddbCharacterId && ddbError && <p className="text-sm text-destructive">{ddbError}</p>}
          {character.ddbCharacterId && ddbStatBlock && (
            <div className="border border-border rounded-xl h-[500px]">
              <StatBlock statBlock={ddbStatBlock} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CharacterFormDialog
        key={character.id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        campaignId={activeCampaignId ?? ""}
        character={character}
        onSaved={load}
      />
    </div>
  );
}
