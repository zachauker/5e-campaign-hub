"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Map as MapIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadMapDialog } from "@/components/maps/UploadMapDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface MapListItem {
  id: string;
  name: string;
}

export default function MapsPage() {
  const { activeCampaignId } = useCampaignStore();
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/maps?campaignId=${activeCampaignId}`).then((res) => {
      if (res.ok) res.json().then(setMaps);
    });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-muted-foreground" /> Maps
        </h1>
        <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Upload Map
        </Button>
      </div>

      {maps.length === 0 && <p className="text-sm text-muted-foreground">No maps yet. Upload one to get started.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {maps.map((m) => (
          <Link
            key={m.id}
            href={`/maps/${m.id}`}
            className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors"
          >
            <div className="aspect-video bg-muted overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map thumbnail */}
              <img
                src={`/api/maps/${m.id}/image`}
                alt={m.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </div>
            <div className="px-3 py-2 text-sm font-medium truncate">{m.name}</div>
          </Link>
        ))}
      </div>

      <UploadMapDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={activeCampaignId ?? ""}
        onUploaded={load}
      />
    </div>
  );
}
