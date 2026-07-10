"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CharacterFormDialog } from "@/components/entities/CharacterFormDialog";
import type { Character } from "@/lib/db/schema";

export default function CharactersPage() {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    const url = `/api/characters?campaignId=${activeCampaignId}${showArchived ? "&includeArchived=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setCharacters(data.items);
        setArchivedCount(data.archivedCount);
      });
  }, [activeCampaignId, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete character?",
      description: "This permanently removes the character from the campaign.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = characters.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Users className="w-7 h-7 flex-none text-[var(--marker-character)]" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">Characters</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{characters.length}</span>{" "}
              {characters.length === 1 ? "hero and villain" : "heroes and villains"} in your campaign
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {archivedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 flex-none">
            <Plus className="w-4 h-4" /> New character
          </Button>
        </div>
      </header>

      <Input
        className="mt-6"
        placeholder="Search characters…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground">
          {characters.length === 0 ? "No characters yet." : "Nothing matches that search."}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-border/60">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group"
            >
              {/* Stretched link keeps the whole row a keyboard-focusable nav target */}
              <Link
                href={`/characters/${c.id}`}
                aria-label={`Open character: ${c.name}`}
                className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
              <span
                className="w-1.5 h-1.5 rounded-full flex-none bg-[var(--marker-character)]"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[15px] leading-tight truncate">{c.name}</p>
              </div>
              <Badge variant={c.type === "pc" ? "hp" : "outline"} className="capitalize relative z-10">
                {c.type}
              </Badge>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete character: ${c.name}`}
                className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                onClick={(e) => remove(c.id, e)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <CharacterFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        campaignId={activeCampaignId ?? ""}
        character={null}
        onSaved={load}
      />
    </div>
  );
}
