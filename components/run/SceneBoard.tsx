"use client";

import React, { useEffect, useState } from "react";
import { useRunStore } from "@/lib/store/run-store";

interface Thread { id: string; title: string; status: string; stakes: string | null }
interface Clock { id: string; name: string; segments: number; filled: number; status: string }

interface SceneBoardProps {
  campaignId: string;
}

// Fast enough that the board never looks stale across a scene, nothing against
// a local SQLite read. No manual refresh control — the DM's hands are busy.
const REFRESH_MS = 15_000;

/**
 * What the left column shows when no encounter is running. Non-combat play gets
 * a home for the first time here, as a composition of #18 data rather than new
 * machinery.
 */
export function SceneBoard({ campaignId }: SceneBoardProps) {
  const pinned = useRunStore((s) => s.pinned);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsError, setThreadsError] = useState(false);
  const [clocks, setClocks] = useState<Clock[]>([]);
  const [clocksError, setClocksError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Bumped on every call so a slow response from an earlier tick can't land
    // after a newer one already resolved, or after unmount.
    let threadsRequestId = 0;
    let clocksRequestId = 0;

    function loadThreads() {
      const requestId = ++threadsRequestId;
      fetch(`/api/threads?campaignId=${campaignId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
        .then((d: { items?: Thread[] }) => {
          if (cancelled || requestId !== threadsRequestId) return;
          setThreads(d.items ?? []);
          setThreadsError(false);
        })
        .catch((err) => {
          if (cancelled || requestId !== threadsRequestId) return;
          // A blank "No open threads" reads identically to a genuinely empty
          // campaign, so a failed fetch here needs its own error state rather
          // than falling through to that copy — see EntityThreadsBlock.
          console.warn(`[SceneBoard] threads fetch failed for campaign ${campaignId}:`, (err as Error).message);
          setThreadsError(true);
        });
    }

    function loadClocks() {
      const requestId = ++clocksRequestId;
      fetch(`/api/clocks?campaignId=${campaignId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
        .then((d: { items?: Clock[] }) => {
          if (cancelled || requestId !== clocksRequestId) return;
          setClocks(d.items ?? []);
          setClocksError(false);
        })
        .catch((err) => {
          if (cancelled || requestId !== clocksRequestId) return;
          console.warn(`[SceneBoard] clocks fetch failed for campaign ${campaignId}:`, (err as Error).message);
          setClocksError(true);
        });
    }

    loadThreads();
    loadClocks();
    const timer = setInterval(() => {
      loadThreads();
      loadClocks();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
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
                <span className="ml-1.5 text-xs text-muted-foreground">{p.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Open threads</h2>
        {threadsError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load threads. Reload to try again.
          </p>
        ) : open.length === 0 ? (
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
        {clocksError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load clocks. Reload to try again.
          </p>
        ) : clocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clocks running.</p>
        ) : (
          <ul className="space-y-1.5">
            {clocks.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">
                  {c.name}
                  {c.status !== "running" && (
                    <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">{c.status}</span>
                  )}
                </span>
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
