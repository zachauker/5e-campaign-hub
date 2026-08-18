"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/lib/store/ui-store";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface SearchResult {
  id: string;
  name: string;
  type: string;
  href: string;
}

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const openAssistantWith = useUIStore((s) => s.openAssistantWith);
  const { activeCampaignId } = useCampaignStore();
  const [query, setQuery] = useState("");
  const [allResults, setAllResults] = useState<SearchResult[]>([]);
  const [assistantConfigured, setAssistantConfigured] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const url = activeCampaignId ? `/api/search?campaignId=${activeCampaignId}` : "/api/search";
    // Threads are campaign-scoped data, unlike /api/search above (which tolerates
    // a missing campaignId and returns everything). /api/threads requires
    // campaignId, so without an active campaign we skip the fetch entirely
    // rather than ever issuing an unscoped request — the cross-campaign leak
    // this shell shipped once before came from exactly this file.
    // Each half degrades on its own. Before this catch, a /api/threads failure
    // rejected the Promise.all and left the palette with NO results at all —
    // one new, optional source of results could blank entity search entirely.
    const threadsPromise: Promise<{ id: string; title: string }[]> = activeCampaignId
      ? fetch(`/api/threads?campaignId=${activeCampaignId}`)
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((data: { items?: { id: string; title: string }[] }) => data.items ?? [])
          .catch(() => [])
      : Promise.resolve([]);

    const entitiesPromise: Promise<SearchResult[]> = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<SearchResult[]>) : []))
      .catch(() => []);

    let cancelled = false;

    Promise.all([entitiesPromise, threadsPromise]).then(
      ([entities, threadItems]) => {
        if (cancelled) return;
        const threadResults: SearchResult[] = threadItems.map((t) => ({
          id: t.id,
          name: t.title,
          type: "thread",
          href: `/chronicle?campaignId=${activeCampaignId}`,
        }));
        const commands: SearchResult[] = activeCampaignId
          ? [
              {
                id: "advance-in-world-date",
                name: "Advance in-world date",
                type: "action",
                href: `/chronicle?campaignId=${activeCampaignId}&tab=timeline`,
              },
            ]
          : [];
        setAllResults([...entities, ...threadResults, ...commands]);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, activeCampaignId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAssistantConfigured(data.anthropic_api_key === "configured");
      })
      .catch(() => {
        if (!cancelled) setAssistantConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? allResults.filter((r) => r.name.toLowerCase().includes(q)) : allResults).slice(0, 8);
  }, [query, allResults]);

  function handleOpenChange(next: boolean) {
    if (next) setQuery("");
    setOpen(next);
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function ask() {
    if (!assistantConfigured) return;
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    openAssistantWith(q);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="w-4 h-4 text-muted-foreground flex-none" />
          <Input
            autoFocus
            placeholder="Jump to a character, location, item, faction, or encounter..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                ask();
              }
            }}
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="text-center py-6 text-sm text-muted-foreground">No matches.</p>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => go(r.href)}
              className="flex items-center justify-between w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm"
            >
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{r.type}</span>
            </button>
          ))}
          {query.trim() && (
            <button
              onClick={ask}
              disabled={!assistantConfigured}
              className={`flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm ${
                assistantConfigured ? "hover:bg-muted" : "cursor-not-allowed opacity-60"
              }`}
            >
              <span className="text-muted-foreground">Ask the assistant:</span>
              <span className="truncate">&ldquo;{query.trim()}&rdquo;</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {assistantConfigured ? "⌘↵" : "Configure in Settings"}
              </span>
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
