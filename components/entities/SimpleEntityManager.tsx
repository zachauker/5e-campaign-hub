// components/entities/SimpleEntityManager.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SimpleEntityFormDialog, type SimpleEntity } from "@/components/entities/SimpleEntityFormDialog";
import { EntityListView } from "@/components/entities/EntityListView";
import type { TypeConfig, RawEntityRow } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

const ACCENT: Record<SimpleEntityManagerProps["resourcePath"], string> = {
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

const TYPE_CONFIG: Partial<Record<SimpleEntityManagerProps["resourcePath"], TypeConfig>> = {
  locations: {
    label: "Type",
    options: [
      { value: "city", label: "City" },
      { value: "town", label: "Town" },
      { value: "poi", label: "Point of Interest" },
      { value: "region", label: "Region" },
      { value: "other", label: "Other" },
    ],
  },
};

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const { activeCampaignId } = useCampaignStore();
  const confirm = useConfirm();
  const [entities, setEntities] = useState<RawEntityRow[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntity, setEditEntity] = useState<SimpleEntity | null>(null);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    const url = `/api/${resourcePath}?campaignId=${activeCampaignId}${showArchived ? "&includeArchived=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setEntities(data.items);
        setArchivedCount(data.archivedCount);
      });
  }, [activeCampaignId, resourcePath, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const singular = label.toLowerCase().replace(/s$/, "");
  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({ title: `Delete ${singular}?`, description: "This permanently removes it from the campaign.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    setEntities((prev) => prev.filter((x) => x.id !== id));
  }

  const accent = ACCENT[resourcePath];

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Icon className="w-7 h-7 flex-none" style={{ color: accent }} />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">{label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{entities.length}</span>{" "}
              {entities.length === 1 ? singular : label.toLowerCase()} across Exandria
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {archivedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 flex-none">
            <Plus className="w-4 h-4" /> New {singular}
          </Button>
        </div>
      </header>

      <EntityListView
        resourcePath={resourcePath}
        label={label}
        singular={singular}
        accent={accent}
        typeConfig={TYPE_CONFIG[resourcePath] ?? null}
        items={entities}
        emptyHint={`No ${label.toLowerCase()} yet.`}
        onEdit={(entity: EntityDetailResponse) =>
          setEditEntity({ id: entity.id, name: entity.name, description: entity.description ?? null, type: entity.type ?? null })
        }
        onDelete={remove}
      />

      <SimpleEntityFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} resourcePath={resourcePath} label={label} campaignId={activeCampaignId ?? ""} entity={null} onSaved={load} />
      <SimpleEntityFormDialog key={editEntity?.id ?? "edit"} open={editEntity !== null} onClose={() => setEditEntity(null)} resourcePath={resourcePath} label={label} campaignId={activeCampaignId ?? ""} entity={editEntity} onSaved={load} />
    </div>
  );
}
