"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunStore } from "@/lib/store/run-store";
import { MARK_TAGS } from "@/lib/run/marks";

function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface MarkStripProps {
  /** Visible while the tag window is open, so digits 1-5 have somewhere to land. */
  tagWindowOpen: boolean;
  onEndRun: () => void;
}

export function MarkStrip({ tagWindowOpen, onEndRun }: MarkStripProps) {
  const startedAt = useRunStore((s) => s.startedAt);
  const sent = useRunStore((s) => s.sent);
  const queue = useRunStore((s) => s.queue);
  const lastError = useRunStore((s) => s.lastError);
  const tagMark = useRunStore((s) => s.tagMark);
  // The strip's tag buttons are a click-instead-of-keystroke fallback for the
  // same window the digit keys use, so they need to know which mark that
  // window belongs to — never a queue position, which is exactly what let a
  // tag land on the wrong mark before (see run-store.ts).
  const taggableLocalId = useRunStore((s) => s.taggableLocalId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = startedAt ? now - startedAt : 0;
  // Only marks that have actually failed a write raise the alarm. Every fresh
  // mark sits in the queue for its tag window by design, so counting the whole
  // queue would flash a warning on every single flag the DM makes — training
  // them to ignore the one indicator that means their marks are not landing.
  const struggling = queue.filter((q) => q.attempts > 0).length;
  const recent = sent.slice(-3).reverse();

  return (
    <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2 text-xs">
      <span className="font-mono tabular-nums text-foreground">{formatOffset(elapsed)}</span>

      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Flag className="h-3.5 w-3.5" aria-hidden />
        {sent.length + queue.length} marks
      </span>

      {tagWindowOpen && taggableLocalId && (
        <span className="flex items-center gap-1.5">
          {MARK_TAGS.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() => tagMark(taggableLocalId, tag)}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-accent"
            >
              {i + 1} {tag}
            </button>
          ))}
        </span>
      )}

      <span className="flex-1 truncate text-muted-foreground">
        {recent.map((m) => `${formatOffset(m.atMs)}${m.tag ? ` ${m.tag}` : ""}`).join("  ·  ")}
      </span>

      {(struggling > 0 || lastError) && (
        <span className="flex items-center gap-1.5 text-amber-400" role="status">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {struggling > 0 ? `${struggling} unsaved` : lastError}
        </span>
      )}

      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEndRun}>
        End run
      </Button>
    </div>
  );
}
