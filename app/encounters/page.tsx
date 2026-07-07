"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Swords,
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  PlayCircle,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Encounter } from "@/lib/db/schema";

const STATUS_CONFIG = {
  idle: { label: "Ready", icon: <Clock className="w-3 h-3" /> },
  active: { label: "Active", icon: <PlayCircle className="w-3 h-3" /> },
  completed: { label: "Done", icon: <CheckCircle2 className="w-3 h-3" /> },
};

export default function EncountersPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { activeCampaignId } = useCampaignStore();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/encounters")
      .then((r) => r.json())
      .then((data) => {
        setEncounters(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function createEncounter() {
    if (!newName.trim() || !activeCampaignId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/encounters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), campaignId: activeCampaignId }),
      });
      const encounter = await res.json();
      router.push(`/encounters/${encounter.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function deleteEncounter(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete encounter?",
      description: "This permanently removes the encounter and its combatants.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/encounters/${id}`, { method: "DELETE" });
    setEncounters((prev) => prev.filter((enc) => enc.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <Swords className="w-7 h-7 flex-none text-primary" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">Encounters</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{encounters.length}</span>{" "}
              {encounters.length === 1 ? "encounter" : "encounters"} logged
            </p>
          </div>
        </div>
      </header>

      {/* Quick-create — name it and drop straight into the fight */}
      <div className="mt-6 flex gap-2">
        <Input
          placeholder="Name a new encounter…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createEncounter()}
          className="flex-1"
        />
        <Button onClick={createEncounter} disabled={creating || !newName.trim()} className="gap-1.5 flex-none">
          <Plus className="w-4 h-4" />
          {creating ? "Creating…" : "Create"}
        </Button>
      </div>

      {loading && <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>}

      {!loading && encounters.length === 0 && (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl">
          <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No encounters yet. Name one above to begin.</p>
        </div>
      )}

      {encounters.length > 0 && (
        <div className="mt-4 divide-y divide-border/60">
          {encounters.map((enc) => {
            const status = STATUS_CONFIG[enc.status as keyof typeof STATUS_CONFIG];
            return (
              <div
                key={enc.id}
                className="relative flex items-center gap-3 px-2 py-3 hover:bg-accent/40 transition-colors group"
              >
                {/* Stretched link keeps the whole row a keyboard-focusable nav target */}
                <Link
                  href={`/encounters/${enc.id}`}
                  aria-label={`Open encounter: ${enc.name}`}
                  className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                />
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg border flex items-center justify-center flex-none",
                    enc.status === "active" && "border-primary/40 bg-primary/10",
                    enc.status === "idle" && "border-border bg-muted",
                    enc.status === "completed" && "border-muted bg-muted/50"
                  )}
                >
                  <Swords
                    className={cn(
                      "w-4 h-4",
                      enc.status === "active" ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[15px] leading-tight truncate">{enc.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(new Date(enc.updatedAt))}
                    {enc.round > 1 && ` · Round ${enc.round}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-none">
                  <span
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                      enc.status === "active" && "text-primary border-primary/40 bg-primary/10",
                      (enc.status === "idle" || enc.status === "completed") && "text-muted-foreground border-border"
                    )}
                  >
                    {status.icon} {status.label}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete encounter: ${enc.name}`}
                    className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                    onClick={(e) => deleteEncounter(enc.id, e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
