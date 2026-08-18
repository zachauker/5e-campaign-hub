"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ClockDial } from "./ClockDial";
import type { ThreadView, ClockView } from "./chronicle-types";

interface EntityThreadsBlockProps {
  campaignId: string;
  targetKind: "character" | "location" | "item" | "faction";
  targetId: string;
  /** Fires once the initial fetch resolves, so the parent page can adjust its own empty-state copy. */
  onHasContentChange?: (hasContent: boolean) => void;
}

type BlockResult =
  | { ok: true; threads: ThreadView[]; clocks: ClockView[] }
  | { ok: false };

async function fetchEntityThreadsAndClocks(
  campaignId: string,
  targetKind: EntityThreadsBlockProps["targetKind"],
  targetId: string,
): Promise<BlockResult> {
  const [tRes, cRes] = await Promise.all([
    fetch(`/api/threads?campaignId=${campaignId}&targetKind=${targetKind}&targetId=${targetId}`),
    // Clocks are owned, not linked, so they come from the clock list and get filtered here.
    fetch(`/api/clocks?campaignId=${campaignId}`),
  ]);

  if (!tRes.ok || !cRes.ok) return { ok: false };

  const threads: ThreadView[] = ((await tRes.json()).items ?? []) as ThreadView[];
  const allClocks: ClockView[] = ((await cRes.json()).items ?? []) as ClockView[];
  const clocks = allClocks.filter((c) => c.ownerKind === targetKind && c.ownerId === targetId);

  return { ok: true, threads, clocks };
}

export function EntityThreadsBlock({
  campaignId,
  targetKind,
  targetId,
  onHasContentChange,
}: EntityThreadsBlockProps) {
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [clocks, setClocks] = useState<ClockView[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const result = await fetchEntityThreadsAndClocks(campaignId, targetKind, targetId);
      if (cancelled) return;
      if (!result.ok) {
        // Rendering nothing here would be indistinguishable from "this faction
        // has no threads", so a DM would conclude the wrong thing about their
        // own campaign from a transient fetch failure.
        setError(true);
        return;
      }
      setError(false);
      setThreads(result.threads);
      setClocks(result.clocks);
      onHasContentChange?.(result.threads.length > 0 || result.clocks.length > 0);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // onHasContentChange is a setState callback from the parent; including it would
    // re-run the fetch on every parent render since it isn't memoized there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, targetKind, targetId]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load this {targetKind}&rsquo;s threads and clocks. Reload to try again.
      </p>
    );
  }

  if (!threads.length && !clocks.length) return null;

  return (
    <section className="space-y-3">
      {threads.length > 0 && (
        <div>
          {/* Not "Open threads": listThreadsForTarget excludes resolved and
              abandoned but keeps dormant ones, so the count covered more than
              the heading claimed. Dormant rows are marked individually below. */}
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unresolved threads ({threads.length})
          </h3>
          <ul className="space-y-1.5">
            {threads.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {t.title}
                    {t.status !== "open" && (
                      <Badge variant="outline" className="ml-2 text-[11px]">
                        {t.status}
                      </Badge>
                    )}
                  </span>
                  {t.daysUntouched !== null && (
                    <span className="flex-none text-xs tabular-nums text-muted-foreground">
                      {t.daysUntouched}d
                    </span>
                  )}
                </div>
                {t.stakes && <p className="mt-0.5 text-xs text-muted-foreground">{t.stakes}</p>}
              </li>
            ))}
          </ul>
          <Link href={`/chronicle?campaignId=${campaignId}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            Open the chronicle →
          </Link>
        </div>
      )}

      {clocks.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clocks</h3>
          <div className="flex flex-wrap gap-4">
            {clocks.map((c) => (
              <ClockDial key={c.id} name={c.name} segments={c.segments} filled={c.filled} status={c.status} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
