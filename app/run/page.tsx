"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { useRunStore } from "@/lib/store/run-store";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { AnswerPanel } from "@/components/run/AnswerPanel";
import { SceneBoard } from "@/components/run/SceneBoard";
import { MarkStrip } from "@/components/run/MarkStrip";
import { Button } from "@/components/ui/button";
import { MARK_TAGS } from "@/lib/run/marks";
import { TAG_WINDOW_MS } from "@/lib/run/mark-queue";
import { generateId } from "@/lib/utils";

/** Attempts before a failed run start is declared unrecoverable (absent a manual retry). */
const START_RUN_MAX_ATTEMPTS = 3;
const START_RUN_RETRY_DELAY_MS = 1000;

export default function RunPage() {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const { encounter } = useEncounterStore();

  // Fine-grained selectors, not a whole-store destructure: this page must not
  // re-render on every `queue`/`sent` mutation (including the 5-second flush
  // below) the way MarkStrip and AnswerPanel already avoid doing.
  const runSessionId = useRunStore((s) => s.runSessionId);
  const startedAt = useRunStore((s) => s.startedAt);
  const beginRun = useRunStore((s) => s.beginRun);
  const endRunLocal = useRunStore((s) => s.endRunLocal);
  const addMark = useRunStore((s) => s.addMark);
  const tagMark = useRunStore((s) => s.tagMark);
  const taggableLocalId = useRunStore((s) => s.taggableLocalId);
  const clearTaggable = useRunStore((s) => s.clearTaggable);
  const flush = useRunStore((s) => s.flush);
  const restoreQueue = useRunStore((s) => s.restoreQueue);

  const [tagWindowOpen, setTagWindowOpen] = useState(false);
  // Set once START_RUN_MAX_ATTEMPTS have failed. While true, marks a DM flags
  // are not being captured at all — dropMark still bails out on a null
  // runSessionId — so this must be loud and stay up until a retry succeeds,
  // never fade on its own like a toast would.
  const [runStartFailed, setRunStartFailed] = useState(false);
  // Bumping this re-runs the start effect below, giving the banner's retry
  // button a way to try again without duplicating the retry/backoff logic.
  const [startAttemptGeneration, setStartAttemptGeneration] = useState(0);
  const contextRef = useRef<{ kind: string; id: string } | null>(null);
  const tagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recover anything a crash left behind before the DM adds tonight's first mark.
  useEffect(() => { restoreQueue(); }, [restoreQueue]);

  // Open the run. A transient hiccup on mount (a slow cold start, one dropped
  // request) must not cost the whole session, so this retries a few times
  // with a short backoff before giving up — and when it does give up, it
  // says so via runStartFailed rather than leaving the DM to discover a
  // silent, unrecoverable failure by pressing Space all evening and getting
  // nothing.
  useEffect(() => {
    if (!activeCampaignId || runSessionId) return;
    let cancelled = false;

    async function startRun() {
      for (let attempt = 1; attempt <= START_RUN_MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ campaignId: activeCampaignId }),
          });
          if (!res.ok) throw new Error(`Run start failed (${res.status})`);
          const run: { id: string; startedAt: string } = await res.json();
          if (cancelled) return;
          beginRun(run.id, new Date(run.startedAt).getTime());
          setRunStartFailed(false);
          return;
        } catch {
          if (cancelled) return;
          if (attempt < START_RUN_MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, START_RUN_RETRY_DELAY_MS));
            if (cancelled) return;
          }
        }
      }
      if (!cancelled) setRunStartFailed(true);
    }

    void startRun();
    return () => { cancelled = true; };
  }, [activeCampaignId, runSessionId, beginRun, startAttemptGeneration]);

  const retryStart = useCallback(() => {
    setStartAttemptGeneration((n) => n + 1);
  }, []);

  // Drain the queue on an interval so a mark written while the server was down
  // still lands without the DM touching anything.
  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, 5000);
    return () => clearInterval(timer);
  }, [flush]);

  const dropMark = useCallback(() => {
    if (!activeCampaignId || !runSessionId || startedAt == null) return;
    // Captured once and passed to addMark, which stashes it as the store's
    // taggableLocalId — the single handle both the digit keys below and
    // MarkStrip's tag buttons use to find this exact mark, never a position.
    const localId = generateId();
    addMark({
      localId,
      campaignId: activeCampaignId,
      runSessionId,
      atMs: Date.now() - startedAt,
      tag: null,
      note: null,
      contextKind: contextRef.current?.kind ?? null,
      contextId: contextRef.current?.id ?? null,
    });
    setTagWindowOpen(true);
    if (tagTimerRef.current) clearTimeout(tagTimerRef.current);
    tagTimerRef.current = setTimeout(() => {
      setTagWindowOpen(false);
      clearTaggable();
    }, TAG_WINDOW_MS);
  }, [activeCampaignId, runSessionId, startedAt, addMark, clearTaggable]);

  // Space marks; digits 1-5 tag it. Digits rather than letters because letters
  // collide with starting a search right after marking, which is exactly what
  // happens when an NPC gets named.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === " " && !typing) {
        e.preventDefault();
        // Holding the key fires an OS key-repeat keydown per tick; without
        // this guard each tick queued another mark.
        if (e.repeat) return;
        dropMark();
        return;
      }
      if (tagWindowOpen && taggableLocalId && !typing && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        tagMark(taggableLocalId, MARK_TAGS[Number(e.key) - 1]);
        setTagWindowOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dropMark, tagWindowOpen, taggableLocalId, tagMark]);

  const endRun = useCallback(async () => {
    if (runSessionId) {
      await flush();
      await fetch(`/api/runs/${runSessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ end: true }),
      }).catch(() => {});
    }
    endRunLocal();
    router.push("/");
  }, [runSessionId, flush, endRunLocal, router]);

  const onContextChange = useCallback((ctx: { kind: string; id: string } | null) => {
    contextRef.current = ctx;
  }, []);

  if (!activeCampaignId) {
    return (
      <div className="flex h-screen items-center justify-center p-8 text-sm text-muted-foreground">
        Pick a campaign before starting a run.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {runStartFailed && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            The run failed to start — marks are NOT being saved.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 border-destructive-foreground/40 bg-transparent text-destructive-foreground hover:bg-destructive-foreground/10"
            onClick={retryStart}
          >
            Retry
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[3] border-r border-border">
          {encounter ? <InitiativeTracker /> : <SceneBoard campaignId={activeCampaignId} />}
        </div>
        <div className="min-w-0 flex-[2] p-4">
          <AnswerPanel campaignId={activeCampaignId} onContextChange={onContextChange} />
        </div>
      </div>
      <MarkStrip tagWindowOpen={tagWindowOpen} onEndRun={() => void endRun()} />
    </div>
  );
}
