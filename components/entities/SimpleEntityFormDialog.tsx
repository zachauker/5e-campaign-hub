"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface SimpleEntity {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
}

interface SimpleEntityFormDialogProps {
  open: boolean;
  onClose: () => void;
  resourcePath: "locations" | "items" | "factions";
  label: string;
  campaignId: string;
  entity?: SimpleEntity | null;
  onSaved: () => void;
}

export function SimpleEntityFormDialog({
  open,
  onClose,
  resourcePath,
  label,
  campaignId,
  entity,
  onSaved,
}: SimpleEntityFormDialogProps) {
  const [name, setName] = useState(entity?.name ?? "");
  const [description, setDescription] = useState(entity?.description ?? "");
  const [notionUrl, setNotionUrl] = useState(entity?.notionUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !campaignId) return;
    setSaving(true);
    try {
      const payload = {
        campaignId,
        name: name.trim(),
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
      };
      if (entity) {
        await fetch(`/api/${resourcePath}/${entity.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/${resourcePath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entity ? `Edit ${label.replace(/s$/, "")}` : `New ${label.replace(/s$/, "")}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea
            placeholder="Description"
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
          <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : entity ? "Save Changes" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
