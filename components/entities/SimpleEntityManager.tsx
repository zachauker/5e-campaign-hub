"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { SimpleEntityFormDialog, type SimpleEntity } from "@/components/entities/SimpleEntityFormDialog";

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const [entities, setEntities] = useState<SimpleEntity[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/${resourcePath}?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setEntities);
  }, [activeCampaignId, resourcePath]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete this ${label.toLowerCase().replace(/s$/, "")}?`)) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    setEntities((prev) => prev.filter((x) => x.id !== id));
  }

  const filtered = entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg flex items-center gap-2"><Icon className="w-4 h-4" /> {label}</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> New {label.replace(/s$/, "")}
        </Button>
      </div>

      <Input placeholder={`Search ${label.toLowerCase()}...`} value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No {label.toLowerCase()} yet.
          </div>
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            onClick={() => router.push(`/${resourcePath}/${e.id}`)}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer group"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{e.name}</p>
              {e.description && <p className="text-xs text-muted-foreground truncate">{e.description}</p>}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
              onClick={(ev) => remove(e.id, ev)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <SimpleEntityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={null}
        onSaved={load}
      />
    </div>
  );
}
