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
  const { activeCampaignId } = useCampaignStore();
  const [query, setQuery] = useState("");
  const [allResults, setAllResults] = useState<SearchResult[]>([]);

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
    fetch(url)
      .then((r) => r.json())
      .then(setAllResults);
  }, [open, activeCampaignId]);

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
        </div>
      </DialogContent>
    </Dialog>
  );
}
