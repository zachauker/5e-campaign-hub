"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BookMarked, Plus, Search, Shield, Skull, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatSheetEditor } from "@/components/bestiary/StatSheetEditor";
import { portraitUrl } from "@/lib/library/portrait";
import { cn } from "@/lib/utils";
import type { CharacterUploadSchema } from "@/lib/character-schema";

type Sheet = CharacterUploadSchema;
type EntryType = Sheet["type"];

interface LibraryEntry {
  id: string;
  name: string;
  type: EntryType;
  data: Sheet;
  imagePath: string | null;
  tags: string[];
}

const TYPE_FILTERS: { value: EntryType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "monster", label: "Monsters" },
  { value: "npc", label: "NPCs" },
  { value: "pc", label: "PCs" },
];

const TYPE_ICON: Record<EntryType, React.ComponentType<{ className?: string }>> = {
  monster: Skull,
  npc: User,
  pc: Shield,
};

const TYPE_COLOR: Record<EntryType, string> = {
  pc: "text-[var(--hp-high)]",
  npc: "text-[var(--initiative)]",
  monster: "text-[var(--hp-low)]",
};

const BLANK_SHEET: Sheet = { name: "", type: "npc", ac: 10, hpMax: 1 };

/** The library stores tags beside `data`; the editor edits them as part of the sheet. */
const sheetOf = (e: LibraryEntry): Sheet => ({ ...e.data, tags: e.tags.length > 0 ? e.tags : undefined });

/** What the right-hand pane is showing. Null id means a sheet not yet saved to the library. */
interface Open {
  entry: LibraryEntry | null;
  draft: Sheet;
  dirty: boolean;
}

export function BestiaryBrowser() {
  const confirm = useConfirm();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntryType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Open | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The portrait URL is stable across replacements, so thumbnails need a cache-buster.
  const [portraitVersion, setPortraitVersion] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  /** Throws on failure; callers decide where the message goes. */
  const fetchEntries = useCallback(async (q: string) => {
    const url = q.trim() ? `/api/library?q=${encodeURIComponent(q.trim())}` : "/api/library";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load the library");
    return (await res.json()) as LibraryEntry[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchEntries(debouncedQuery)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the library");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, fetchEntries]);

  const refresh = async () => {
    try {
      setEntries(await fetchEntries(debouncedQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the library");
    }
  };

  const visible = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);

  /** Leaving a sheet with unsaved edits asks first. */
  const confirmLeave = async () =>
    !open?.dirty ||
    (await confirm({
      title: "Discard unsaved changes?",
      description: "The sheet you are editing has changes that have not been saved.",
      confirmLabel: "Discard",
      destructive: true,
    }));

  const select = async (entry: LibraryEntry) => {
    if (entry.id === open?.entry?.id) return;
    if (!(await confirmLeave())) return;
    setError(null);
    setOpen({ entry, draft: sheetOf(entry), dirty: false });
  };

  const startNew = async () => {
    if (!(await confirmLeave())) return;
    setError(null);
    setOpen({ entry: null, draft: BLANK_SHEET, dirty: false });
  };

  const save = async (sheet: Sheet) => {
    if (!open) return;
    setSaving(true);
    setError(null);
    try {
      const existing = open.entry;
      const res = await fetch(existing ? `/api/library/${existing.id}` : "/api/library", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // Tags are their own column; send [] so clearing the field clears the column.
        body: JSON.stringify({ ...sheet, tags: sheet.tags ?? [] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not save the sheet");
      }
      // PATCH answers { ok }; re-read the row so the pane reflects what the server stored.
      const id = existing ? existing.id : ((await res.json()) as { id: string }).id;
      const saved = await fetch(`/api/library/${id}`);
      if (!saved.ok) throw new Error("Saved, but could not reload the entry");
      const entry = (await saved.json()) as LibraryEntry;
      setOpen({ entry, draft: sheetOf(entry), dirty: false });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the sheet");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setError(null);
    setOpen((o) => (o?.entry ? { entry: o.entry, draft: sheetOf(o.entry), dirty: false } : null));
  };

  const remove = async () => {
    const entry = open?.entry;
    if (!entry) return;
    const ok = await confirm({
      title: `Delete ${entry.name}?`,
      description: "This removes it from the library, along with its uploaded portrait. Encounters that already use it are not affected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/library/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete the entry");
      setOpen(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the entry");
    }
  };

  const onPortraitChanged = (imagePath: string | null) => {
    setOpen((o) => (o?.entry ? { ...o, entry: { ...o.entry, imagePath } } : o));
    setEntries((prev) => prev.map((e) => (e.id === open?.entry?.id ? { ...e, imagePath } : e)));
    setPortraitVersion((v) => v + 1);
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col px-6 py-6">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <BookMarked className="h-7 w-7 flex-none text-[var(--marker-character)]" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none">Bestiary</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">{entries.length}</span>{" "}
              {entries.length === 1 ? "creature" : "creatures"} in your library
            </p>
          </div>
        </div>
        <Button size="sm" onClick={startNew} className="flex-none gap-1.5">
          <Plus className="h-4 w-4" /> New entry
        </Button>
      </header>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name or tag..."
              aria-label="Search the bestiary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-1" role="group" aria-label="Filter by type">
            {TYPE_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={typeFilter === f.value ? "default" : "outline"}
                aria-pressed={typeFilter === f.value}
                className="flex-1 px-2"
                onClick={() => setTypeFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {!loading && visible.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">
                {entries.length === 0 && !debouncedQuery ? "The library is empty." : "Nothing matches."}
              </li>
            )}
            {visible.map((entry) => {
              const Icon = TYPE_ICON[entry.type];
              const thumb = portraitUrl(entry);
              const selected = open?.entry?.id === entry.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={selected}
                    onClick={() => void select(entry)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-primary bg-accent" : "border-border hover:border-primary/50 hover:bg-accent/50"
                    )}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.imagePath ? `${thumb}?v=${portraitVersion}` : thumb}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Icon className={cn("h-5 w-5", TYPE_COLOR[entry.type])} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className={cn("capitalize", TYPE_COLOR[entry.type])}>{entry.type}</span> · AC {entry.data.ac} · HP{" "}
                        {entry.data.hpMax}
                        {entry.tags.length > 0 && ` · ${entry.tags.join(", ")}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="flex min-h-0 flex-col rounded-lg border border-border p-4">
          {open ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="truncate font-display text-2xl leading-none">{open.entry ? open.entry.name : "New entry"}</h2>
                {open.entry && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${open.entry.name} from library`}
                    onClick={() => void remove()}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                )}
              </div>
              <StatSheetEditor
                // The editor seeds its draft rows and imagePath from props once; the key remounts it per entry.
                key={open.entry?.id ?? "new"}
                className="min-h-0 flex-1"
                value={open.draft}
                entryId={open.entry?.id ?? null}
                imagePath={open.entry?.imagePath ?? null}
                onChange={(draft) => setOpen((o) => (o ? { ...o, draft, dirty: true } : o))}
                onSave={save}
                onCancel={cancel}
                saving={saving}
                onPortraitChanged={onPortraitChanged}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <BookMarked className="h-8 w-8 opacity-50" />
              <p className="text-sm">Select a creature to view and edit its sheet, or start a new entry.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
