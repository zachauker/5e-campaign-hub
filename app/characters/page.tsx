// app/characters/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EntityListView } from "@/components/entities/EntityListView";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import type { TypeConfig, RawEntityRow } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

const TYPE_CONFIG: TypeConfig = {
  label: "Type",
  options: [
    { value: "pc", label: "PC", badgeVariant: "hp" },
    { value: "npc", label: "NPC", badgeVariant: "outline" },
  ],
};

export default function CharactersPage() {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [characters, setCharacters] = useState<RawEntityRow[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCharacter, setEditCharacter] = useState<CharacterWithLinks | null>(null);

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
    const ok = await confirm({ title: "Delete character?", description: "This permanently removes the character from the campaign.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
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

      <EntityListView
        resourcePath="characters"
        label="Characters"
        singular="character"
        accent="var(--marker-character)"
        typeConfig={TYPE_CONFIG}
        items={characters}
        emptyHint="No characters yet."
        onEdit={(entity: EntityDetailResponse) => setEditCharacter(entity as unknown as CharacterWithLinks)}
        onDelete={remove}
      />

      <CharacterFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} campaignId={activeCampaignId ?? ""} character={null} onSaved={load} />
      <CharacterFormDialog key={editCharacter?.id ?? "edit"} open={editCharacter !== null} onClose={() => setEditCharacter(null)} campaignId={activeCampaignId ?? ""} character={editCharacter} onSaved={load} />
    </div>
  );
}
