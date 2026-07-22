// components/maps/PinStylesPanel.tsx
"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkerAppearanceEditor } from "@/components/maps/MarkerAppearanceEditor";
import { MARKER_TYPES, MARKER_TYPE_META } from "@/components/maps/marker-meta";
import type { TypeAppearanceMap, MarkerAppearanceOverride } from "@/components/maps/marker-appearance";
import type { MarkerType } from "@/components/maps/map-types";

interface Props {
  open: boolean;
  value: TypeAppearanceMap;
  onClose: () => void;
  onSaved: (next: TypeAppearanceMap) => void;
}

export function PinStylesPanel({ open, value, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<TypeAppearanceMap>(value);
  const [saving, setSaving] = useState(false);

  // Re-seed the draft from `value` each time the dialog transitions from
  // closed to open, done during render (guarded so it settles in one pass)
  // rather than in a set-state effect — mirrors the layer/label seeding
  // pattern used in the map viewers.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(value);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const setType = (type: MarkerType, next: MarkerAppearanceOverride) => setDraft((d) => ({ ...d, [type]: next }));

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marker_appearance: JSON.stringify(draft) }),
      });
      onSaved(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pin styles</DialogTitle></DialogHeader>
        <div className="space-y-5">
          {MARKER_TYPES.map((type) => (
            <div key={type} className="space-y-1.5">
              <p className="text-sm font-medium" style={{ color: MARKER_TYPE_META[type].color }}>{MARKER_TYPE_META[type].label}</p>
              <MarkerAppearanceEditor value={draft[type] ?? {}} onChange={(next) => setType(type, next)} type={type} />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save styles"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
