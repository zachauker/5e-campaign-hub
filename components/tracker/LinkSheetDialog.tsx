"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LibraryEntry } from "@/lib/library/entry";

/** A library search that hands back the chosen entry. The caller decides what linking does. */
export function LinkSheetDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const url = query.trim() ? `/api/library?q=${encodeURIComponent(query.trim())}` : "/api/library";
        const res = await fetch(url);
        if (!res.ok) throw new Error("Could not load the library");
        const rows = (await res.json()) as LibraryEntry[];
        if (!cancelled) {
          setResults(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the library");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Link a stat sheet</DialogTitle>
          <DialogDescription>Pick a library entry to use as this combatant&apos;s sheet.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search name or tag..."
            aria-label="Search the library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {loading && (
            <li className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </li>
          )}
          {!loading && !error && results.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nothing matches.</li>
          )}
          {results.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onPick(entry)}
                className="flex w-full flex-col rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm font-medium">{entry.name}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="capitalize">{entry.type}</span> · AC {entry.data.ac} · HP {entry.data.hpMax}
                  {entry.tags.length > 0 && ` · ${entry.tags.join(", ")}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
