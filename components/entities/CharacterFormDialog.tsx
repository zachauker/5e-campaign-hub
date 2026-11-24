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
import { LinkSheetDialog } from "@/components/tracker/LinkSheetDialog";
import type { LibraryEntry } from "@/lib/library/entry";
import type { Character, Faction, Location, Item } from "@/lib/db/schema";

// The detail route returns `sourceProps` decoded, not as the raw JSON column.
export type CharacterWithLinks = Omit<Character, "sourceProps"> & {
  factionIds: string[];
  locationIds: string[];
  itemIds: string[];
  mapMarkers: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  sourceProps?: { label: string; value: string }[];
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
  const [ddbCharacterId, setDdbCharacterId] = useState(character?.ddbCharacterId ?? "");
  const [factions, setFactions] = useState<Faction[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factionIds, setFactionIds] = useState<string[]>(character?.factionIds ?? []);
  const [locationIds, setLocationIds] = useState<string[]>(character?.locationIds ?? []);
  const [itemIds, setItemIds] = useState<string[]>(character?.itemIds ?? []);
  const [saving, setSaving] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(character?.statSheetId ?? null);
  // The linked sheet's details for display; the id alone says nothing to the DM.
  const [sheet, setSheet] = useState<LibraryEntry | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingSheet, setCreatingSheet] = useState(false);

  useEffect(() => {
    if (!sheetId) return;
    if (sheet?.id === sheetId) return;
    let cancelled = false;
    fetch(`/api/library/${sheetId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load the linked stat sheet");
        return res.json() as Promise<LibraryEntry>;
      })
      .then((entry) => {
        if (!cancelled) setSheet(entry);
      })
      .catch((err) => {
        if (!cancelled) setSheetError(err instanceof Error ? err.message : "Could not load the linked stat sheet");
      });
    return () => {
      cancelled = true;
    };
  }, [sheetId, sheet]);

  function linkSheet(entry: LibraryEntry) {
    setSheet(entry);
    setSheetId(entry.id);
    setSheetError(null);
    setPickerOpen(false);
  }

  function unlinkSheet() {
    setSheet(null);
    setSheetId(null);
    setSheetError(null);
  }

  /** A blank sheet named for this NPC, linked straight away. The DM fills in its stats in the library. */
  async function createSheet() {
    if (!name.trim()) return;
    setCreatingSheet(true);
    setSheetError(null);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: "npc", ac: 10, hpMax: 10 }),
      });
      if (!res.ok) throw new Error("Could not create the stat sheet");
      linkSheet((await res.json()) as LibraryEntry);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Could not create the stat sheet");
    } finally {
      setCreatingSheet(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    Promise.all([
      fetch("/api/factions").then((r) => r.json()),
      fetch("/api/locations").then((r) => r.json()),
      fetch("/api/items").then((r) => r.json()),
    ])
      .then(([f, l, i]) => {
        setFactions(f.items);
        setLocations(l.items);
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
        ddbCharacterId: ddbCharacterId.trim() || null,
        // null unlinks on PATCH; POST stores it as given.
        statSheetId: sheetId,
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
            placeholder="D&D Beyond character ID (optional)"
            value={ddbCharacterId}
            onChange={(e) => setDdbCharacterId(e.target.value)}
          />

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Stat sheet</label>
            <div className="rounded-md border border-border p-2.5 space-y-2">
              {sheetId ? (
                <p className="text-sm" data-testid="sheet-linked">
                  {sheet ? (
                    <>
                      <span className="font-medium">{sheet.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {" "}· AC {sheet.data.ac} · HP {sheet.data.hpMax}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Loading linked sheet...</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No sheet linked. Adding this character to a fight will ask for AC, HP and initiative by hand.
                </p>
              )}
              {sheetError && (
                <p role="alert" className="text-xs text-destructive">
                  {sheetError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  {sheetId ? "Change sheet" : "Link a sheet"}
                </Button>
                {!sheetId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={createSheet}
                    disabled={creatingSheet || !name.trim()}
                  >
                    {creatingSheet ? "Creating..." : "Create from name"}
                  </Button>
                )}
                {sheetId && (
                  <Button type="button" variant="outline" size="sm" onClick={unlinkSheet}>
                    Unlink
                  </Button>
                )}
              </div>
            </div>
          </div>
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
      <LinkSheetDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={linkSheet} />
    </Dialog>
  );
}
