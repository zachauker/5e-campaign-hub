"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { useRunStore } from "@/lib/store/run-store";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { AnswerPanel } from "@/components/run/AnswerPanel";
import { SceneBoard } from "@/components/run/SceneBoard";
import { MarkStrip } from "@/components/run/MarkStrip";
import { MARK_TAGS } from "@/lib/run/marks";
import { TAG_WINDOW_MS } from "@/lib/run/mark-queue";
import { generateId } from "@/lib/utils";

export default function RunPage() {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const { encounter } = useEncounterStore();
  const {
    runSessionId, startedAt, beginRun, endRunLocal, addMark, tagMark, taggableLocalId,
    clearTaggable, flush, restoreQueue,
  } = useRunStore();

  const [tagWindowOpen, setTagWindowOpen] = useState(false);
  const contextRef = useRef<{ kind: string; id: string } | null>(null);
  const tagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recover anything a crash left behind before the DM adds tonight's first mark.
  useEffect(() => { restoreQueue(); }, [restoreQueue]);

  // Open the run.
  useEffect(() => {
    if (!activeCampaignId || runSessionId) return;
    let cancelled = false;
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: activeCampaignId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((run: { id: string; startedAt: string } | null) => {
        if (cancelled || !run) return;
        beginRun(run.id, new Date(run.startedAt).getTime());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCampaignId, runSessionId, beginRun]);

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
        dropMark();
        return;
      }
      if (tagWindowOpen && taggableLocalId && /^[1-5]$/.test(e.key)) {
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
