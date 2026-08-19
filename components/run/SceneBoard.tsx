"use client";

import React, { useEffect, useState } from "react";
import { useRunStore } from "@/lib/store/run-store";

interface Thread { id: string; title: string; status: string; stakes: string | null }
interface Clock { id: string; name: string; segments: number; filled: number }

interface SceneBoardProps {
  campaignId: string;
}

/**
 * What the left column shows when no encounter is running. Non-combat play gets
 * a home for the first time here, as a composition of #18 data rather than new
 * machinery.
 */
export function SceneBoard({ campaignId }: SceneBoardProps) {
  const pinned = useRunStore((s) => s.pinned);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [clocks, setClocks] = useState<Clock[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threads?campaignId=${campaignId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Thread[] }) => { if (!cancelled) setThreads(d.items ?? []); })
      .catch(() => {});
    fetch(`/api/clocks?campaignId=${campaignId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Clock[] }) => { if (!cancelled) setClocks(d.items ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId]);

  const open = threads.filter((t) => t.status === "open");

  return (
    <div className="space-y-6 overflow-y-auto p-4">
      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">In the room</h2>
        {pinned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pinned. Search for someone and press Enter to keep them on screen.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {pinned.map((p) => (
              <li key={p.targetId} className="rounded border border-amber-500/40 bg-card px-2.5 py-1 text-sm">
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Open threads</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open threads.</p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((t) => (
              <li key={t.id} className="text-sm">
                <span className="text-foreground">{t.title}</span>
                {t.stakes && <span className="text-muted-foreground"> — {t.stakes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Clocks</h2>
        {clocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clocks running.</p>
        ) : (
          <ul className="space-y-1.5">
            {clocks.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{c.name}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {c.filled}/{c.segments}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
