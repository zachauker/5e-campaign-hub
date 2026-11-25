"use client";

import React, { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { EncounterControls } from "@/components/tracker/EncounterControls";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { StatBlockPanel } from "@/components/tracker/StatBlockPanel";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, RefreshCw, X } from "lucide-react";
import type { EncounterWithCombatants } from "@/lib/types";
import { useDDBSync } from "@/lib/hooks/useDDBSync";
import { combatSnapshot, fullSave } from "@/lib/encounters/payload";

/** Floating undo toast shown when a combatant is removed. Auto-dismisses after 5s. */
function UndoToast() {
  const { pendingRemove, restoreLastRemoved, clearPendingRemove } = useEncounterStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pendingRemove) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clearPendingRemove(), 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pendingRemove, clearPendingRemove]);

  if (!pendingRemove) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{pendingRemove.name}</span> removed
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={restoreLastRemoved}
      >
        Undo
      </Button>
    </div>
  );
}

/**
 * Persistent, unmissable alarm shown when a save fails. Unlike the ambient
 * "Save failed" text in the controls bar, this does not auto-dismiss — a lost
 * save is the one failure a DM must not miss mid-session, so it stays until the
 * save succeeds or the DM explicitly dismisses it.
 */
function SaveErrorToast({
  message,
  saving,
  onRetry,
  onDismiss,
}: {
  message: string;
  saving: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-destructive rounded-lg pl-4 pr-2 py-2.5 shadow-2xl shadow-destructive/20 animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none"
    >
      <AlertTriangle className="w-4 h-4 text-destructive flex-none" />
      <div className="text-sm">
        <span className="font-semibold text-foreground">Encounter not saved</span>
        <span className="text-muted-foreground"> — {message}</span>
      </div>
      <Button size="sm" onClick={onRetry} disabled={saving} className="h-7 text-xs gap-1.5">
        <RefreshCw className={`w-3 h-3 ${saving ? "animate-spin" : ""}`} />
        {saving ? "Retrying…" : "Retry"}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onDismiss}
        className="flex-none"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export default function EncounterPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { encounter, setEncounter, isDirty, markClean } = useEncounterStore();
  const { refreshAll, lastSyncedAt, syncing, syncErrors } = useDDBSync();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/encounters/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Encounter not found");
        return r.json();
      })
      .then((data: EncounterWithCombatants) => {
        setEncounter(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, setEncounter]);

  const save = useCallback(async () => {
    if (!encounter) return;
    // Cancel any in-flight save so the latest write always wins — rapid HP
    // edits can otherwise fire overlapping PATCHes that resolve out of order.
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/encounters/${encounter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullSave(encounter)),
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(`Server error (${r.status})`);
      markClean();
    } catch (e) {
      // A newer save superseded this one — not a real failure.
      if (controller.signal.aborted) return;
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      // Only the most recent save controls the shared saving state.
      if (saveAbortRef.current === controller) {
        saveAbortRef.current = null;
        setSaving(false);
      }
    }
  }, [encounter, markClean]);

  // Keep the newest save reachable from the teardown handlers below without
  // making them re-subscribe on every edit.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Leaving the page by client-side navigation: send the pending edit now
  // rather than letting the auto-save cleanup drop its timer. An in-flight save
  // is deliberately left to finish — aborting it here would be the data loss we
  // are trying to prevent, and the state it sets afterwards is a no-op.
  useEffect(
    () => () => {
      if (useEncounterStore.getState().isDirty) void saveRef.current();
    },
    []
  );

  // Leaving by refresh, closing the tab or a hard navigation: React runs no
  // cleanup and an ordinary fetch does not outlive the page, so the save goes
  // out with `keepalive`. Its body is capped at 64KB and a real encounter's
  // stat blocks and D&D Beyond sheets alone run past that, so this sends the
  // combat snapshot — the fields a fight changes. saveEncounter leaves every
  // field the payload omits untouched.
  useEffect(() => {
    const flush = () => {
      const { encounter: current, isDirty: dirty } = useEncounterStore.getState();
      if (!current || !dirty) return;
      void fetch(`/api/encounters/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(combatSnapshot(current)),
        keepalive: true,
      }).catch(() => {
        // The page is going away; there is nowhere left to report this.
      });
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Auto-save when dirty
  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, save]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-destructive">{error}</p>
        <Button onClick={() => router.push("/encounters")}>Back to Encounters</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* The combatant column (--tracker-col plus its px-4) and the w-80 stat
          pane grow with the window, then centre together once they stop. */}
      <div className="flex flex-1 overflow-hidden w-full max-w-[calc(var(--tracker-col)+2rem+20rem)] mx-auto">
        {/* Main column */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <EncounterControls
            onSave={save}
            saving={saving}
            saveError={saveError}
            onNavigateBack={() => router.push("/encounters")}
          />
          <div className="flex-1 overflow-hidden">
            <InitiativeTracker />
          </div>
        </div>

        {/* Stat block sidebar */}
        <StatBlockPanel
          onRefresh={refreshAll}
          lastSyncedAt={lastSyncedAt}
          syncing={syncing}
          syncErrors={syncErrors}
        />
      </div>

      {/* Persistent alarm when a save fails — the one failure the DM must not miss */}
      {saveError && (
        <SaveErrorToast
          message={saveError}
          saving={saving}
          onRetry={save}
          onDismiss={() => setSaveError(null)}
        />
      )}

      {/* Undo toast for combatant removal */}
      <UndoToast />
    </div>
  );
}
