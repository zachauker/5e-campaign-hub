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
  showResolved: boolean;
  onShowResolvedChange: (show: boolean) => void;
  /** Resolve, reopen, abandon — the caller confirms and reports failures. */
  onSetStatus: (thread: ThreadView, status: "open" | "resolved") => void;
  onEdit: (thread: ThreadView) => void;
}

export function ThreadsTab({
  threads,
  showResolved,
  onShowResolvedChange,
  onSetStatus,
  onEdit,
}: ThreadsTabProps) {
  const open = threads.filter((t) => t.status === "open");
  const dormant = threads.filter((t) => t.status === "dormant");
  const closed = threads.filter((t) => t.status === "resolved" || t.status === "abandoned");

  const toggle = (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input
        type="checkbox"
        checked={showResolved}
        onChange={(e) => onShowResolvedChange(e.target.checked)}
      />
      Show resolved
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">{toggle}</div>

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showResolved
            ? "No threads yet, resolved or otherwise."
            : "No open threads. Open one from here, or run a session review to have them proposed from your notes."}
        </p>
      ) : (
        <>
          <Section title="Open" threads={open} onSetStatus={onSetStatus} onEdit={onEdit} />
          <Section title="Dormant" threads={dormant} onSetStatus={onSetStatus} onEdit={onEdit} />
          <Section title="Closed" threads={closed} onSetStatus={onSetStatus} onEdit={onEdit} />
        </>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  threads: ThreadView[];
  onSetStatus: ThreadsTabProps["onSetStatus"];
  onEdit: ThreadsTabProps["onEdit"];
}

function Section({ title, threads, onSetStatus, onEdit }: SectionProps) {
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
          const isClosed = t.status === "resolved" || t.status === "abandoned";
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

              <div className="mt-2 flex flex-wrap gap-1">
                {/* Closed threads are only visible under "Show resolved", where
                    every row is closed — so which kind of closed it is has to be
                    on the row itself, not implied by the section. */}
                {isClosed && (
                  <Badge variant="outline" className="text-[11px]">
                    {t.status}
                  </Badge>
                )}
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

              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
                  Edit
                </Button>
                {isClosed ? (
                  <Button size="sm" variant="ghost" onClick={() => onSetStatus(t, "open")}>
                    Reopen
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => onSetStatus(t, "resolved")}>
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
