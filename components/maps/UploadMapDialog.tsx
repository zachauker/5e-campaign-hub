"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface UploadMapDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onUploaded: () => void;
}

export function UploadMapDialog({ open, onClose, campaignId, onUploaded }: UploadMapDialogProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function upload() {
    if (!name.trim() || !file || !campaignId) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("campaignId", campaignId);
      form.append("image", file);
      await fetch("/api/maps", { method: "POST", body: form });
      onUploaded();
      onClose();
      setName("");
      setFile(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Map</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input autoFocus placeholder="Map name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-muted-foreground"
          />
          <Button className="w-full" onClick={upload} disabled={saving || !name.trim() || !file}>
            {saving ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
