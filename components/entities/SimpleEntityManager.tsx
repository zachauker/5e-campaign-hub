"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface SimpleEntity {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
}

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

function SimpleEntityManagerInner({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const searchParams = useSearchParams();
  const { activeCampaignId } = useCampaignStore();
  const [entities, setEntities] = useState<SimpleEntity[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SimpleEntity | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/${resourcePath}?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setEntities);
  }, [activeCampaignId, resourcePath]);

  useEffect(() => {
    load();
  }, [load]);

  async function openEdit(id: string) {
    const res = await fetch(`/api/${resourcePath}/${id}`);
    if (!res.ok) return;
    const entity: SimpleEntity = await res.json();
    setEditing(entity);
    setName(entity.name);
    setDescription(entity.description ?? "");
    setNotionUrl(entity.notionUrl ?? "");
    setDialogOpen(true);
  }

  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/${resourcePath}/${openId}`);
      if (!res.ok || cancelled) return;
      const entity: SimpleEntity = await res.json();
      if (cancelled) return;
      setEditing(entity);
      setName(entity.name);
      setDescription(entity.description ?? "");
      setNotionUrl(entity.notionUrl ?? "");
      setDialogOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, resourcePath]);

  function openCreate() {
    setEditing(null);
    setName(""); setDescription(""); setNotionUrl("");
    setDialogOpen(true);
  }

  async function save() {
    if (!name.trim() || !activeCampaignId) return;
    setSaving(true);
    try {
      const payload = {
        campaignId: activeCampaignId,
        name: name.trim(),
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
      };
      if (editing) {
        await fetch(`/api/${resourcePath}/${editing.id}`, {
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
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

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
        <Button size="sm" onClick={openCreate} className="gap-1.5">
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
            onClick={() => openEdit(e.id)}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${label.replace(/s$/, "")}` : `New ${label.replace(/s$/, "")}`}</DialogTitle>
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
            <Input placeholder="Notion page URL (optional)" value={notionUrl} onChange={(e) => setNotionUrl(e.target.value)} />
            <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SimpleEntityManager(props: SimpleEntityManagerProps) {
  return (
    <Suspense fallback={null}>
      <SimpleEntityManagerInner {...props} />
    </Suspense>
  );
}
