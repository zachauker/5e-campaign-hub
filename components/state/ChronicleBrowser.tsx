"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SetDatePrompt } from "./SetDatePrompt";
import { ThreadsTab } from "./ThreadsTab";
import { ThreadFormDialog } from "./ThreadFormDialog";
import { TimelineTab } from "./TimelineTab";
import type { CampaignStateView, ThreadView } from "./chronicle-types";

type StateResult = { ok: true; state: CampaignStateView } | { ok: false; error: string };

async function fetchState(campaignId: string, includeResolved: boolean): Promise<StateResult> {
  const res = await fetch(`/api/campaigns/${campaignId}/state${includeResolved ? "?includeResolved=1" : ""}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Could not load campaign state" };
  }
  return { ok: true, state: (await res.json()) as CampaignStateView };
}

export function ChronicleBrowser({ campaignId }: { campaignId: string }) {
  // Lets the command palette's "Advance in-world date" command land directly on
  // the Timeline tab via /chronicle?tab=timeline. Read once at mount, not
  // synced back on tab clicks — this is a deep-link entry point, not a
  // persisted URL-as-state pattern.
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "timeline" ? "timeline" : "threads";
  const confirm = useConfirm();
  const [state, setState] = useState<CampaignStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a failed write must not blank the page that
  // shows what the write was for.
  const [actionError, setActionError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [editing, setEditing] = useState<ThreadView | null>(null);
  const [creating, setCreating] = useState(false);

  const apply = useCallback((result: StateResult) => {
    if (result.ok) {
      setState(result.state);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  /** Imperative refresh after a write. */
  const load = useCallback(async () => {
    apply(await fetchState(campaignId, showResolved));
  }, [apply, campaignId, showResolved]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const result = await fetchState(campaignId, showResolved);
      if (!cancelled) apply(result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [apply, campaignId, showResolved]);

  async function setThreadStatus(thread: ThreadView, status: "open" | "resolved") {
    setActionError(null);

    // Resolving pulls the thread out of every list the UI asks for by default,
    // so it has to be deliberate — and the prompt says how to get back.
    if (status === "resolved") {
      const ok = await confirm({
        title: `Resolve "${thread.title}"?`,
        description:
          "It leaves the open board and the entity pages it is linked to. Tick “Show resolved” here to find it again and reopen it.",
        confirmLabel: "Resolve",
      });
      if (!ok) return;
    }

    const res = await fetch(`/api/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(
        body.error ?? `Could not ${status === "resolved" ? "resolve" : "reopen"} "${thread.title}".`,
      );
      return;
    }
    await load();
  }

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!state) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  // Nothing downstream means anything without an in-world date, so this is the gate.
  if (state.currentDay === null) {
    return (
      <div className="p-6">
        <SetDatePrompt campaignId={campaignId} onSaved={load} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">{state.currentDateLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {state.threads.filter((t) => t.status === "open").length} open thread(s),{" "}
            {state.clocks.filter((c) => c.status === "running").length} running clock(s)
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            New thread
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditingDate((v) => !v)}>
            {editingDate ? "Cancel" : "Correct date"}
          </Button>
        </div>
      </header>

      {editingDate && (
        <SetDatePrompt
          campaignId={campaignId}
          initialDay={state.currentDay}
          initialEpochLabel={state.epochLabel}
          onSaved={async () => {
            setEditingDate(false);
            await load();
          }}
          onCancel={() => setEditingDate(false)}
        />
      )}

      {/* Keyed on initialTab: the command palette's "Advance in-world date" link
          can land here while ChronicleBrowser is already mounted (same campaignId
          prop, client-side navigation from an in-app search result), and Radix's
          uncontrolled Tabs ignores a defaultValue change on an existing instance.
          The key forces a fresh mount so the URL's tab param actually takes. */}
      <Tabs key={initialTab} defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="threads">Threads</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="threads" className="mt-4">
          {actionError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {actionError}
            </p>
          )}
          <ThreadsTab
            threads={state.threads}
            showResolved={showResolved}
            onShowResolvedChange={setShowResolved}
            onSetStatus={(t, s) => void setThreadStatus(t, s)}
            onEdit={setEditing}
          />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineTab campaignId={campaignId} state={state} onChanged={load} />
        </TabsContent>
      </Tabs>

      {/* Mounted fresh per edit: ThreadFormDialog seeds its fields from props via
          useState, so keeping it mounted would show the previous thread's values
          on the second edit. */}
      {(editing || creating) && (
        <ThreadFormDialog
          campaignId={campaignId}
          thread={editing}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditing(null);
              setCreating(false);
            }
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}
