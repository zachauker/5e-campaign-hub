"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface SessionNote {
  id: string;
  name: string;
  noteType: string | null;
  status: string | null;
  date: string | null;
}

// Display order for the Type groups.
const TYPE_ORDER = ["Story Outline", "Session Notes", "Character Event", "Combat Encounter", "RP Encounter"];

export function SessionNotesBrowser() {
  const { activeCampaignId } = useCampaignStore();
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/sessions?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then((data) => {
        setNotes(data.items ?? []);
        setArchivedCount(data.archivedCount ?? 0);
      });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = TYPE_ORDER
    .map((type) => ({ type, items: notes.filter((n) => (n.noteType ?? "Uncategorized") === type) }))
    .filter((g) => g.items.length > 0);
  const uncategorized = notes.filter((n) => !n.noteType || !TYPE_ORDER.includes(n.noteType));
  if (uncategorized.length) groups.push({ type: "Uncategorized", items: uncategorized });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-2 mb-6">
        <ScrollText className="w-5 h-5" style={{ color: "var(--marker-note)" }} />
        <h1 className="font-display text-2xl">Sessions</h1>
        {archivedCount > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">{archivedCount} archived</span>
        )}
      </div>

      {notes.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No session notes yet. Configure the Session Timeline database in{" "}
          <Link href="/settings" className="text-primary hover:underline">Settings</Link> and sync.
        </p>
      )}

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.type}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.type}</h2>
            <ul className="space-y-1.5">
              {g.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/sessions/${n.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-muted-foreground/40 transition-colors"
                  >
                    <span className="font-medium truncate">{n.name}</span>
                    <span className="flex items-center gap-3 flex-none text-xs text-muted-foreground">
                      {n.status && <span>{n.status}</span>}
                      {n.date && <span>{n.date}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
