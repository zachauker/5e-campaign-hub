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
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/characters?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setCharacters);
  }, [activeCampaignId]);

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
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg flex items-center gap-2">
          <Users className="w-4 h-4" /> Characters
        </h1>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Character
        </Button>
      </div>

      <Input placeholder="Search characters..." value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No characters yet.
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className="relative flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors group"
          >
            {/* Stretched link makes the whole row a keyboard-focusable nav target */}
            <Link
              href={`/characters/${c.id}`}
              aria-label={`Open character: ${c.name}`}
              className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{c.name}</p>
            </div>
            <Badge variant={c.type === "pc" ? "hp" : "outline"} className="capitalize">
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
