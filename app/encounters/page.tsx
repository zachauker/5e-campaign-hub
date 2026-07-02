"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import type { Encounter } from "@/lib/db/schema";

const STATUS_CONFIG = {
  idle: { label: "Ready", icon: <Clock className="w-3 h-3" /> },
  active: { label: "Active", icon: <PlayCircle className="w-3 h-3" /> },
  completed: { label: "Done", icon: <CheckCircle2 className="w-3 h-3" /> },
};

export default function EncountersPage() {
  const router = useRouter();
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
    if (!confirm("Delete this encounter?")) return;
    await fetch(`/api/encounters/${id}`, { method: "DELETE" });
    setEncounters((prev) => prev.filter((enc) => enc.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h2 className="font-semibold">New Encounter</h2>
        <div className="flex gap-2">
          <Input
            placeholder="Encounter name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createEncounter()}
            className="flex-1"
          />
          <Button onClick={createEncounter} disabled={creating || !newName.trim()} className="gap-1.5">
            <Plus className="w-4 h-4" />
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
          Encounters ({encounters.length})
        </h2>

        {loading && <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>}

        {!loading && encounters.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No encounters yet. Create one above.</p>
          </div>
        )}

        <div className="space-y-2">
          {encounters.map((enc) => {
            const status = STATUS_CONFIG[enc.status as keyof typeof STATUS_CONFIG];
            return (
              <div
                key={enc.id}
                onClick={() => router.push(`/encounters/${enc.id}`)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg border flex items-center justify-center flex-none",
                    enc.status === "active" && "border-primary/40 bg-primary/10",
                    enc.status === "idle" && "border-border bg-muted",
                    enc.status === "completed" && "border-muted bg-muted/50"
                  )}
                >
                  <Swords
                    className={cn(
                      "w-4 h-4",
                      enc.status === "active" && "text-primary",
                      (enc.status === "idle" || enc.status === "completed") && "text-muted-foreground"
                    )}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{enc.name}</p>
                  <p className="text-xs text-muted-foreground">
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
                    className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                    onClick={(e) => deleteEncounter(enc.id, e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
