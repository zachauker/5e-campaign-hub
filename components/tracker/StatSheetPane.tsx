"use client";

import React, { useEffect, useState } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { StatBlock } from "./StatBlock";
import { PCSheet } from "./PCSheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { StatSheetEditorDialog } from "@/components/bestiary/StatSheetEditorDialog";
import { LinkSheetDialog } from "./LinkSheetDialog";
import { RefreshCw, AlertTriangle, Pencil, BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";
import { statBlockToUpload, type CharacterUploadSchema } from "@/lib/character-schema";
import { mergeSheetOverStored } from "@/lib/library/save-back";
import { baseName } from "@/lib/encounters/duplicates";
import { portraitUrl } from "@/lib/library/portrait";
import type { LibraryEntry } from "@/lib/library/entry";
import type { CombatantWithParsed } from "@/lib/types";

type Sheet = CharacterUploadSchema;

/** The editor over one combatant. `opens` keys the dialog: the editor seeds its rows from props once. */
interface EditorState {
  mode: "edit" | "create";
  combatantId: string;
  draft: Sheet;
  opens: number;
}

/** D&D Beyond sync state. All optional: only the encounter page runs a sync, so run mode passes none. */
interface StatSheetPaneProps {
  onRefresh?: () => void;
  lastSyncedAt?: Date | null;
  syncing?: boolean;
  syncErrors?: Set<string>;
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

/**
 * Live-updating relative time. The label is derived from `date` during render
 * (always fresh), and a 10s tick forces a re-render — no state mirroring in an
 * effect, so no cascading render.
 */
function useRelativeTime(date: Date | null): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [date]);

  return formatRelativeTime(date);
}

/**
 * The content of the stat-sheet pane for the selected combatant: a PC sheet, a stat block, link/create
 * actions, or a hint, plus the mid-fight editor. It has no width or border of its own, so each host
 * (the encounter page's side panel, run mode's tab) supplies the shell.
 */
export function StatSheetPane({ onRefresh, lastSyncedAt, syncing, syncErrors }: StatSheetPaneProps) {
  const { encounter, selectedCombatantId, selectCombatant, applyCombatantSheet, updateCombatant } = useEncounterStore();
  const toast = useToast();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [linking, setLinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opens, setOpens] = useState(0);

  const combatant = encounter?.combatants.find((c) => c.id === selectedCombatantId);
  const isPCWithSheet = combatant?.type === "pc" && !!combatant.ddbCharacter;
  const hasError = combatant ? (syncErrors?.has(combatant.id) ?? false) : false;

  const syncLabel = useRelativeTime(lastSyncedAt ?? null);

  // Esc clears the selection. Guard against firing while the DM is typing in a
  // field (notes, HP, name).
  useEffect(() => {
    if (!selectedCombatantId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      selectCombatant(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCombatantId, selectCombatant]);

  const openEditor = (c: CombatantWithParsed, mode: EditorState["mode"]) => {
    setOpens((n) => n + 1);
    setEditor({ mode, combatantId: c.id, draft: statBlockToUpload(c), opens: opens + 1 });
  };

  /** Records the NPC's sheet on its character entity so it has one next session too. */
  const linkCharacter = async (c: CombatantWithParsed, libraryId: string) => {
    if (!c.characterId) return;
    try {
      const res = await fetch(`/api/characters/${c.characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statSheetId: libraryId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast({
        title: "Sheet linked here only",
        description: `${c.name} has the sheet for this fight, but the character record could not be updated.`,
        variant: "error",
      });
    }
  };

  /** A mid-fight edit changes this combatant only. The library entry is never touched here. */
  const saveEdit = (sheet: Sheet) => {
    if (!editor) return;
    applyCombatantSheet(editor.combatantId, sheet);
    setEditor(null);
  };

  /** Create a sheet: a new library row, snapshotted onto the combatant and linked from its character. */
  const saveCreate = async (draft: Sheet) => {
    // The pane shows a combatant's stat block, so a sheet needs one even when the DM added no detail.
    const sheet: Sheet = { ...draft, statBlock: draft.statBlock ?? {} };
    const c = encounter?.combatants.find((x) => x.id === editor?.combatantId);
    if (!c) return;
    setSaving(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sheet, tags: sheet.tags ?? [] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not save the sheet");
      }
      const entry = (await res.json()) as LibraryEntry;
      applyCombatantSheet(c.id, sheet);
      updateCombatant(c.id, { libraryId: entry.id });
      await linkCharacter(c, entry.id);
      setEditor(null);
    } catch (err) {
      toast({ title: "Sheet not saved", description: err instanceof Error ? err.message : "Could not save the sheet", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const pickSheet = async (c: CombatantWithParsed, entry: LibraryEntry) => {
    // The DM named this combatant; linking supplies the stats, not a new name.
    applyCombatantSheet(c.id, {
      ...entry.data,
      name: c.name,
      avatarUrl: portraitUrl(entry) ?? entry.data.avatarUrl,
      statBlock: entry.data.statBlock ?? {},
    });
    updateCombatant(c.id, { libraryId: entry.id });
    setLinking(false);
    await linkCharacter(c, entry.id);
  };

  /**
   * Save to library: layer this combatant's sheet over the stored one. PATCH replaces `data`,
   * and a combatant cannot carry the entry's tags or notes, so the stored entry is read first.
   */
  const saveToLibrary = async (c: CombatantWithParsed) => {
    const libraryId = c.libraryId;
    if (!libraryId) return;
    const lost = () => {
      updateCombatant(c.id, { libraryId: null });
      toast({
        title: "Library entry is gone",
        description: `${c.name}'s entry was deleted from the library, so nothing was saved. This combatant keeps its sheet.`,
        variant: "error",
        duration: 0,
      });
    };
    setSaving(true);
    try {
      const current = await fetch(`/api/library/${libraryId}`);
      if (current.status === 404) return lost();
      if (!current.ok) throw new Error("Could not read the library entry");
      const entry = (await current.json()) as LibraryEntry;
      const res = await fetch(`/api/library/${libraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...mergeSheetOverStored(entry.data, { ...statBlockToUpload(c), name: baseName(c.name) }), tags: entry.tags }),
      });
      if (res.status === 404) return lost();
      if (!res.ok) throw new Error("Could not update the library entry");
      toast({ title: "Saved to library", description: `${c.name} updated in the bestiary.`, variant: "success" });
    } catch (err) {
      toast({ title: "Not saved to library", description: err instanceof Error ? err.message : "Could not save", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {combatant && (isPCWithSheet || combatant.statBlock) ? (
        <>
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-none gap-2">
            <span className="text-sm font-semibold shrink-0">
              {isPCWithSheet ? "Character Sheet" : "Stat Block"}
            </span>

            {!isPCWithSheet && (
              <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
                {combatant.libraryId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void saveToLibrary(combatant)}
                    title="Write this combatant's sheet back to its library entry"
                  >
                    <BookMarked className="w-3.5 h-3.5" /> Save to library
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => openEditor(combatant, "edit")}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
              </div>
            )}

            {isPCWithSheet && (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {/* Stale data warning */}
                {hasError && (
                  <span
                    className="flex items-center gap-0.5 text-[10px] text-warning shrink-0"
                    title="Sync failed — data may be stale"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Stale
                  </span>
                )}
                {/* Sync time */}
                {syncLabel && !hasError && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {syncing ? "Syncing…" : syncLabel}
                  </span>
                )}
                {syncing && !hasError && (
                  <span className="text-[10px] text-muted-foreground">Syncing…</span>
                )}
                {onRefresh && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={onRefresh}
                    disabled={syncing}
                    title="Refresh from D&D Beyond"
                    className="shrink-0 ml-auto"
                  >
                    <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {isPCWithSheet && combatant.ddbCharacter ? (
              <PCSheet char={combatant.ddbCharacter} />
            ) : combatant.statBlock ? (
              <StatBlock statBlock={combatant.statBlock} />
            ) : null}
          </div>
        </>
      ) : combatant ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-sm font-semibold">{combatant.name}</span>
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            Link a stat sheet
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(combatant, "create")}>
            Create a sheet
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          Select a combatant
        </div>
      )}

      {editor && (
        <StatSheetEditorDialog
          // Keyed per combatant and open: the editor seeds its rows and Speed draft from props once.
          key={`${editor.combatantId}:${editor.mode}:${editor.opens}`}
          open
          onClose={() => setEditor(null)}
          value={editor.draft}
          // No library row is attached here, so the portrait cannot be changed from the tracker.
          entryId={null}
          onChange={(draft) => setEditor((e) => (e ? { ...e, draft } : e))}
          onSave={editor.mode === "create" ? saveCreate : saveEdit}
          onCancel={() => setEditor(null)}
          saving={saving}
          // A combatant has nowhere to keep tags or notes, so an edit here would be silently dropped.
          hideLibraryFields={editor.mode === "edit"}
        />
      )}
      {combatant && (
        <LinkSheetDialog open={linking} onClose={() => setLinking(false)} onPick={(entry) => void pickSheet(combatant, entry)} />
      )}
    </div>
  );
}
