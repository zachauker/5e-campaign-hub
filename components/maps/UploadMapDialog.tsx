"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface UploadMapDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onUploaded: () => void;
}

export function UploadMapDialog({ open, onClose, campaignId, onUploaded }: UploadMapDialogProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [renderMode, setRenderMode] = useState<"static" | "tiled">("static");
  const [saving, setSaving] = useState(false);

  async function upload() {
    if (!name.trim() || !file || !campaignId) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("campaignId", campaignId);
      form.append("renderMode", renderMode);
      form.append("image", file);
      await fetch("/api/maps", { method: "POST", body: form });
      onUploaded();
      onClose();
      setName("");
      setFile(null);
      setRenderMode("static");
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
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setRenderMode("static")}
              className={cn(
                "rounded-md border px-3 py-2 text-xs text-left transition-colors",
                renderMode === "static"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="font-medium">Standard</div>
              <div className="text-[11px] opacity-80">City layouts, dungeons, smaller images</div>
            </button>
            <button
              type="button"
              onClick={() => setRenderMode("tiled")}
              className={cn(
                "rounded-md border px-3 py-2 text-xs text-left transition-colors",
                renderMode === "tiled"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="font-medium">Large-scale interactive</div>
              <div className="text-[11px] opacity-80">Continent maps, deep zoom, upload may take a while</div>
            </button>
          </div>
          <input
            type="file"
            accept={renderMode === "tiled" ? "image/png,image/jpeg,image/webp" : "image/*"}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-muted-foreground"
          />
          <Button className="w-full" onClick={upload} disabled={saving || !name.trim() || !file}>
            {saving ? (renderMode === "tiled" ? "Generating tiles... this may take a minute" : "Uploading...") : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
