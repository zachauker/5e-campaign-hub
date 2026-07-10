// app/characters/[id]/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, Map as MapIcon, UserRound } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { StatBlock } from "@/components/tracker/StatBlock";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ddbCharacterToStatBlock } from "@/lib/ddb/client";
import type { NotionBlockData } from "@/lib/notion/client";
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

  const [notionBlocks, setNotionBlocks] = useState<NotionBlockData[] | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionLoading, setNotionLoading] = useState(false);

  const [ddbCharacter, setDdbCharacter] = useState<DDBCharacter | null>(null);
  const [ddbError, setDdbError] = useState<string | null>(null);
  const [ddbLoading, setDdbLoading] = useState(false);

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
    if (!character?.notionUrl) return;
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
    run(character.notionUrl);
    return () => {
      cancelled = true;
    };
  }, [character?.notionUrl]);

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
          <TabsTrigger value="notion">Notion Notes</TabsTrigger>
          <TabsTrigger value="ddb">D&D Beyond</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          {character.description && (
            <p className="text-[15px] leading-relaxed text-foreground/85 max-w-[68ch]">
              {character.description}
            </p>
          )}

          {character.notionProps && character.notionProps.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg">Notion properties</h3>
              <NotionPropsTable props={character.notionProps} />
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

          {!character.description && character.mapMarkers.length === 0 && factions.length === 0 && locations.length === 0 && items.length === 0 && (
            <p className="text-sm text-muted-foreground">No description or relationships yet.</p>
          )}
        </TabsContent>

        <TabsContent value="notion" className="pt-4">
          {!character.notionUrl && (
            <p className="text-sm text-muted-foreground">No Notion page linked. Add one via Edit.</p>
          )}
          {character.notionUrl && notionLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Notion page...
            </div>
          )}
          {character.notionUrl && notionError && <p className="text-sm text-destructive">{notionError}</p>}
          {character.notionUrl && notionBlocks && (
            <div className="space-y-3">
              <a
                href={character.notionUrl}
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
