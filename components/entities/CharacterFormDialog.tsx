"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Character, Faction, Location, Item } from "@/lib/db/schema";

export type CharacterWithLinks = Character & {
  factionIds: string[];
  locationIds: string[];
  itemIds: string[];
  mapMarkers: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  notionProps?: { label: string; value: string }[];
};

interface CharacterFormDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  character?: CharacterWithLinks | null;
  onSaved: () => void;
}

function RelationList({
  list,
  selected,
  onToggle,
}: {
  list: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <ScrollArea className="h-28 border border-border rounded-md p-2">
      {list.length === 0 && <p className="text-xs text-muted-foreground px-1">None yet.</p>}
      {list.map((item) => (
        <label
          key={item.id}
          className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer hover:bg-accent rounded"
        >
          <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
          {item.name}
        </label>
      ))}
    </ScrollArea>
  );
}

export function CharacterFormDialog({
  open,
  onClose,
  campaignId,
  character,
  onSaved,
}: CharacterFormDialogProps) {
  const [name, setName] = useState(character?.name ?? "");
  const [type, setType] = useState<"pc" | "npc">(character?.type ?? "npc");
  const [description, setDescription] = useState(character?.description ?? "");
  const [notionUrl, setNotionUrl] = useState(character?.notionUrl ?? "");
  const [ddbCharacterId, setDdbCharacterId] = useState(character?.ddbCharacterId ?? "");
  const [factions, setFactions] = useState<Faction[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factionIds, setFactionIds] = useState<string[]>(character?.factionIds ?? []);
  const [locationIds, setLocationIds] = useState<string[]>(character?.locationIds ?? []);
  const [itemIds, setItemIds] = useState<string[]>(character?.itemIds ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    Promise.all([
      fetch("/api/factions").then((r) => r.json()),
      fetch("/api/locations").then((r) => r.json()),
      fetch("/api/items").then((r) => r.json()),
    ])
      .then(([f, l, i]) => {
        setFactions(f.items);
        setLocations(l);
        setItems(i.items);
      })
      .catch(() => {
        // Relationship lookups are optional for the form; leave lists empty on failure.
      });
  }, [open]);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        campaignId,
        name: name.trim(),
        type,
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
        ddbCharacterId: ddbCharacterId.trim() || null,
      };

      let id = character?.id;
      if (!id) {
        const created = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        id = created.id;
      } else {
        await fetch(`/api/characters/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      await Promise.all([
        fetch(`/api/characters/${id}/factions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factionIds }),
        }),
        fetch(`/api/characters/${id}/locations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationIds }),
        }),
        fetch(`/api/characters/${id}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds }),
        }),
      ]);

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{character ? "Edit Character" : "New Character"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <Input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="flex gap-2">
            <button
              onClick={() => setType("pc")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-sm border",
                type === "pc" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              PC
            </button>
            <button
              onClick={() => setType("npc")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-sm border",
                type === "npc" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              NPC
            </button>
          </div>

          <textarea
            placeholder="Description / notes"
            aria-label="Description / notes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <Input
            placeholder="Notion page URL (optional)"
            value={notionUrl}
            onChange={(e) => setNotionUrl(e.target.value)}
          />
          <Input
            placeholder="D&D Beyond character ID (optional)"
            value={ddbCharacterId}
            onChange={(e) => setDdbCharacterId(e.target.value)}
          />

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Factions</label>
            <RelationList list={factions} selected={factionIds} onToggle={(id) => toggle(factionIds, setFactionIds, id)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Locations</label>
            <RelationList
              list={locations}
              selected={locationIds}
              onToggle={(id) => toggle(locationIds, setLocationIds, id)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Items</label>
            <RelationList list={items} selected={itemIds} onToggle={(id) => toggle(itemIds, setItemIds, id)} />
          </div>

          <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : character ? "Save Changes" : "Create Character"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
