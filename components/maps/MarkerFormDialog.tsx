"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MarkerType, MarkerData } from "@/components/maps/map-types";
export type { MarkerData };

interface EntityOption {
  id: string;
  name: string;
}

interface MapOption {
  id: string;
  name: string;
  parentMapId: string | null;
}

interface MarkerFormDialogProps {
  mapId: string;
  campaignId: string;
  position: { x: number; y: number } | null;
  marker: MarkerData | null;
  currentZoom?: number;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_OPTIONS: { value: MarkerType; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "faction", label: "Faction" },
  { value: "character", label: "Character" },
  { value: "submap", label: "Sub-map" },
  { value: "note", label: "Note" },
];

export function MarkerFormDialog({ mapId, campaignId, position, marker, currentZoom, onClose, onSaved }: MarkerFormDialogProps) {
  const [type, setType] = useState<MarkerType>(marker?.type ?? "note");
  const [entityId, setEntityId] = useState(marker?.entityId ?? "");
  const [targetMapId, setTargetMapId] = useState(marker?.targetMapId ?? "");
  const [title, setTitle] = useState(marker?.title ?? "");
  const [note, setNote] = useState(marker?.note ?? "");
  const [minZoom, setMinZoom] = useState<number | null>(marker?.minZoom ?? currentZoom ?? null);
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [mapOptions, setMapOptions] = useState<MapOption[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (type === "character" || type === "location" || type === "faction") {
        const path = type === "character" ? "characters" : type === "location" ? "locations" : "factions";
        const res = await fetch(`/api/${path}?campaignId=${campaignId}`);
        if (cancelled) return;
        setEntityOptions(res.ok ? await res.json() : []);
      } else if (type === "submap") {
        const res = await fetch(`/api/maps?campaignId=${campaignId}&includeNested=true`);
        if (cancelled) return;
        const data: MapOption[] = res.ok ? await res.json() : [];
        setMapOptions(data.filter((m) => m.parentMapId === null && m.id !== mapId));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [type, campaignId, mapId]);

  async function save() {
    setSaving(true);
    try {
      let finalTargetMapId = targetMapId || null;

      if (type === "submap" && uploadFile && uploadName.trim()) {
        const form = new FormData();
        form.append("name", uploadName.trim());
        form.append("campaignId", campaignId);
        form.append("parentMapId", mapId);
        form.append("image", uploadFile);
        const res = await fetch("/api/maps", { method: "POST", body: form });
        const newMap = await res.json();
        finalTargetMapId = newMap.id;
      }

      const payload = {
        x: position?.x,
        y: position?.y,
        type,
        entityId: type === "character" || type === "location" || type === "faction" ? entityId || null : null,
        targetMapId: type === "submap" ? finalTargetMapId : null,
        title: title.trim() || null,
        note: type === "note" ? note.trim() || null : null,
        minZoom,
      };

      if (marker) {
        await fetch(`/api/maps/markers/${marker.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/maps/${mapId}/markers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    (type === "note" && title.trim().length > 0) ||
    ((type === "character" || type === "location" || type === "faction") && entityId.length > 0) ||
    (type === "submap" && (targetMapId.length > 0 || (uploadFile !== null && uploadName.trim().length > 0)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{marker ? "Edit Marker" : "New Marker"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-5 gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setType(opt.value);
                  setEntityId("");
                  setTargetMapId("");
                  setUploadName("");
                  setUploadFile(null);
                }}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  type === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(type === "character" || type === "location" || type === "faction") && (
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              <option value="">Select {type}...</option>
              {entityOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          {type === "submap" && (
            <div className="space-y-2">
              <select
                value={targetMapId}
                onChange={(e) => {
                  setTargetMapId(e.target.value);
                  if (e.target.value) {
                    setUploadName("");
                    setUploadFile(null);
                  }
                }}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="">Select an existing map...</option>
                {mapOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Or upload a new map to nest here:</p>
              <Input
                placeholder="New map name"
                value={uploadName}
                onChange={(e) => {
                  setUploadName(e.target.value);
                  if (e.target.value) setTargetMapId("");
                }}
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-muted-foreground"
              />
            </div>
          )}

          {type === "note" && (
            <textarea
              placeholder="Note text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}

          {currentZoom !== undefined && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={minZoom === null}
                  onChange={(e) => setMinZoom(e.target.checked ? null : currentZoom)}
                />
                Always visible
              </label>
              {minZoom !== null && (
                <>
                  <span>Visible from zoom</span>
                  <input
                    type="number"
                    min={0}
                    value={minZoom}
                    onChange={(e) => setMinZoom(Number(e.target.value))}
                    className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                  />
                </>
              )}
            </div>
          )}

          <Input
            placeholder={type === "note" ? "Title" : "Title override (optional)"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Button className="w-full" onClick={save} disabled={saving || !canSave}>
            {saving ? "Saving..." : marker ? "Save Changes" : "Place Marker"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
