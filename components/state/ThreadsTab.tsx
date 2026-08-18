"use client";

import Link from "next/link";
import { AlertTriangle, CircleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ThreadView } from "./chronicle-types";

const KIND_ROUTES: Record<string, string> = {
  character: "/characters",
  location: "/locations",
  item: "/items",
  faction: "/factions",
  session: "/sessions",
};

interface Staleness {
  label: string;
  tone: string;
  /** Paired with the colour so urgency is never signalled by colour alone. */
  icon: LucideIcon | null;
  /** Spoken after the day count for screen readers. */
  note: string;
}

function staleness(days: number | null): Staleness {
  if (days === null) {
    return {
      label: "—",
      tone: "text-muted-foreground",
      icon: null,
      note: "staleness unknown, no in-world date recorded when this thread was last touched",
    };
  }
  if (days >= 90) {
    return { label: `${days}d untouched`, tone: "text-destructive", icon: AlertTriangle, note: "long neglected" };
  }
  if (days >= 30) {
    return { label: `${days}d untouched`, tone: "text-orange-500", icon: CircleAlert, note: "going cold" };
  }
  return { label: `${days}d untouched`, tone: "text-muted-foreground", icon: null, note: "recently touched" };
}

interface ThreadsTabProps {
  threads: ThreadView[];
  onResolve: (thread: ThreadView) => void;
  onEdit: (thread: ThreadView) => void;
}

export function ThreadsTab({ threads, onResolve, onEdit }: ThreadsTabProps) {
  const open = threads.filter((t) => t.status === "open");
  const dormant = threads.filter((t) => t.status === "dormant");

  if (!threads.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No open threads. Open one from here, or run a session review to have them proposed from your notes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Open" threads={open} onResolve={onResolve} onEdit={onEdit} />
      {dormant.length > 0 && (
        <Section title="Dormant" threads={dormant} onResolve={onResolve} onEdit={onEdit} />
      )}
    </div>
  );
}

function Section({ title, threads, onResolve, onEdit }: { title: string } & ThreadsTabProps) {
  if (!threads.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({threads.length})
      </h3>
      <ul className="space-y-2">
        {threads.map((t) => {
          const stale = staleness(t.daysUntouched);
          const StaleIcon = stale.icon;
          return (
            <li key={t.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.title}</p>
                  {t.stakes && <p className="mt-0.5 text-sm text-muted-foreground">{t.stakes}</p>}
                </div>
                <span className={`flex flex-none items-center gap-1 text-xs tabular-nums ${stale.tone}`}>
                  {StaleIcon && <StaleIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {stale.label}
                  <span className="sr-only">, {stale.note}</span>
                </span>
              </div>

              {t.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.links.map((l, i) => {
                    const base = KIND_ROUTES[l.targetKind];
                    // A dangling targetId (the entity was deleted; the schema
                    // deliberately does not cascade) degrades to a dead chip
                    // rather than a crash — the kind and role still read.
                    const chip = (
                      <Badge variant="outline" className="text-[11px]">
                        {l.targetKind}
                        {l.role !== "subject" ? ` · ${l.role}` : ""}
                      </Badge>
                    );
                    return base ? (
                      <Link key={i} href={`${base}/${l.targetId}`}>
                        {chip}
                      </Link>
                    ) : (
                      <span key={i}>{chip}</span>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onResolve(t)}>
                  Resolve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
