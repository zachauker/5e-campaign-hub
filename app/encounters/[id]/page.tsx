"use client";

import React, { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { EncounterControls } from "@/components/tracker/EncounterControls";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { StatBlockPanel } from "@/components/tracker/StatBlockPanel";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { EncounterWithCombatants } from "@/lib/types";
import { useDDBSync } from "@/lib/hooks/useDDBSync";

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
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/encounters/${encounter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: encounter.status,
          round: encounter.round,
          currentCombatantId: encounter.currentCombatantId,
          notes: encounter.notes,
          combatants: encounter.combatants,
        }),
      });
      if (!r.ok) throw new Error(`Server error (${r.status})`);
      markClean();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [encounter, markClean]);

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
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-destructive">{error}</p>
        <Button onClick={() => router.push("/")}>Back to Encounters</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Main column */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <EncounterControls
            onSave={save}
            saving={saving}
            saveError={saveError}
            onNavigateBack={() => router.push("/")}
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

      {/* Undo toast for combatant removal */}
      <UndoToast />
    </div>
  );
}
