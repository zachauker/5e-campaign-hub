"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FeatureType, MapFeatureData } from "@/components/maps/map-types";

interface FeatureFormDialogProps {
  mapId: string;
  type: FeatureType;
  geometry: GeoJSON.Geometry | null;
  feature: MapFeatureData | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const TYPE_LABEL: Record<FeatureType, string> = { region: "Region", road: "Road", label: "Label" };

export function FeatureFormDialog({ mapId, type, geometry, feature, onClose, onSaved, onDeleted }: FeatureFormDialogProps) {
  const [name, setName] = useState(feature?.name ?? "");

  const [fillColor, setFillColor] = useState(feature?.type === "region" ? feature.style.fillColor : "#4a7c59");
  const [strokeColor, setStrokeColor] = useState(feature?.type === "region" ? feature.style.strokeColor : "#4a7c59");
  const [color, setColor] = useState(
    feature?.type === "road" ? feature.style.color : feature?.type === "label" ? feature.style.color : "#8a6d3b"
  );
  const [width, setWidth] = useState(feature?.type === "road" ? feature.style.width : 2);
  const [dash, setDash] = useState(feature?.type === "road" ? feature.style.dash : false);
  const [fontSize, setFontSize] = useState(feature?.type === "label" ? feature.style.fontSize : 14);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      if (feature) {
        const style =
          feature.type === "region"
            ? { fillColor, strokeColor }
            : feature.type === "road"
              ? { color, width, dash }
              : { fontSize, color };
        await fetch(`/api/maps/features/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || null, style }),
        });
      } else {
        const style =
          type === "region" ? { fillColor, strokeColor } : type === "road" ? { color, width, dash } : { fontSize, color };
        await fetch(`/api/maps/${mapId}/features`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, name: name.trim() || null, geometry, style }),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!feature) return;
    setSaving(true);
    try {
      await fetch(`/api/maps/features/${feature.id}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setSaving(false);
    }
  }

  const displayType = feature?.type ?? type;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{feature ? `Edit ${TYPE_LABEL[displayType]}` : `New ${TYPE_LABEL[displayType]}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          {displayType === "region" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Fill
                <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Border
                <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
              </label>
            </div>
          )}

          {displayType === "road" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Color
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Width
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={dash} onChange={(e) => setDash(e.target.checked)} />
                Dashed
              </label>
            </div>
          )}

          {displayType === "label" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Color
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Size
                <input
                  type="number"
                  min={8}
                  max={48}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                />
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} disabled={saving}>
              {saving ? "Saving..." : feature ? "Save Changes" : "Create"}
            </Button>
            {feature && (
              <Button variant="destructive" onClick={remove} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
