"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BriefingCard, type BriefingCardData } from "./BriefingCard";
import { useRunStore } from "@/lib/store/run-store";
import { cn } from "@/lib/utils";

interface Hit { id: string; name: string; type: string; href: string }

interface AnswerPanelProps {
  campaignId: string;
  /** Reports what is on screen so a mark can capture it for free. */
  onContextChange: (context: { kind: string; id: string } | null) => void;
}

const BRIEFABLE = new Set(["character", "location", "item", "faction"]);

export function AnswerPanel({ campaignId, onContextChange }: AnswerPanelProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [briefing, setBriefing] = useState<BriefingCardData | null>(null);
  const [stale, setStale] = useState(false);
  const [fallback, setFallback] = useState<{ description: string | null; threads: string[] }>({
    description: null, threads: [],
  });
  const [building, setBuilding] = useState(false);
  const [related, setRelated] = useState<{ kind: string; targetId: string; name: string }[]>([]);
  const [relatedCursor, setRelatedCursor] = useState(0);
  // Cards the DM arrived at by following a relation. Left arrow walks back up it.
  const [, setHistory] = useState<Hit[]>([]);
  const [override, setOverride] = useState<Hit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The live selection, readable from inside an in-flight async callback.
  // `build`'s closure captures whichever hit was selected when it was created,
  // which is precisely the value that must not decide where the result lands.
  const selectedRef = useRef<Hit | null>(null);

  const pinned = useRunStore((s) => s.pinned);
  const pin = useRunStore((s) => s.pin);
  const unpin = useRunStore((s) => s.unpin);

  // Search. Debounced lightly — the query is local SQLite, so this is about
  // avoiding wasted renders, not about protecting a slow backend.
  //
  // When the query is empty we skip the fetch and let `effectiveHits` below
  // short-circuit to empty rather than clearing `hits` here —
  // react-hooks/set-state-in-effect rejects a synchronous setState in this
  // branch (no async work precedes it), and deriving the empty case in the
  // memo avoids the workaround entirely. Mirrors CommandPalette's fix.
  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/search?campaignId=${campaignId}&q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data: { items?: Hit[] }) => {
          if (cancelled) return;
          setHits(data.items ?? []);
          setCursor(0);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, campaignId]);

  // No fetch ran when the query is empty (see above), so `hits` may still
  // hold a stale response from a previous query — short-circuit here rather
  // than showing it.
  const effectiveHits = useMemo(() => (query.trim() ? hits : []), [query, hits]);
  const selected = override ?? effectiveHits[cursor] ?? null;
  const briefable = selected && BRIEFABLE.has(selected.type) ? selected : null;

  // Report what is on screen so a mark can capture it for free, regardless
  // of whether the selection is briefable.
  useEffect(() => {
    onContextChange(selected ? { kind: selected.type, id: selected.id } : null);
  }, [selected, onContextChange]);

  // Load the selected hit's briefing. Skips the fetch when there is nothing
  // briefable selected; `effectiveBriefing`/`effectiveStale`/`effectiveFallback`
  // below derive the empty case instead of clearing state here synchronously.
  useEffect(() => {
    if (!briefable) return;

    let cancelled = false;
    fetch(`/api/briefings?campaignId=${campaignId}&targetKind=${briefable.type}&targetId=${briefable.id}`)
      .then((r) => (r.ok ? r.json() : { briefing: null, stale: false }))
      .then((data: { briefing: BriefingCardData | null; stale: boolean }) => {
        if (cancelled) return;
        setBriefing(data.briefing);
        setStale(data.stale);
      })
      .catch(() => {
        if (!cancelled) {
          setBriefing(null);
          setStale(false);
        }
      });

    fetch(`/api/threads?campaignId=${campaignId}&targetKind=${briefable.type}&targetId=${briefable.id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: { title: string }[] }) => {
        if (!cancelled) {
          setFallback((f) => ({ ...f, threads: (data.items ?? []).map((t) => t.title) }));
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [briefable, campaignId]);

  // No fetch ran when nothing briefable is selected, so `briefing`/`stale`/
  // `fallback` may still hold a stale response from a previous selection.
  const effectiveBriefing = useMemo(() => (briefable ? briefing : null), [briefable, briefing]);
  const effectiveStale = useMemo(() => (briefable ? stale : false), [briefable, stale]);
  const effectiveFallback = useMemo(
    () => (briefable ? fallback : { description: null, threads: [] }),
    [briefable, fallback],
  );

  // Entities that share an open thread with whatever is selected — the → key
  // follows one, ← walks back. Keyed on `briefable` (same gate as the briefing
  // fetch above): skips the fetch when nothing relations even apply to is
  // selected, and `effectiveRelated` below derives the empty case instead of
  // clearing state here synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!briefable) return;
    let cancelled = false;
    fetch(`/api/relations?campaignId=${campaignId}&targetKind=${briefable.type}&targetId=${briefable.id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: { kind: string; targetId: string; name: string }[] }) => {
        if (cancelled) return;
        setRelated(d.items ?? []);
        setRelatedCursor(0);
      })
      .catch(() => { if (!cancelled) setRelated([]); });
    return () => { cancelled = true; };
  }, [briefable, campaignId]);

  // No fetch ran when nothing briefable is selected, so `related` may still
  // hold a stale response from a previous selection.
  const effectiveRelated = useMemo(() => (briefable ? related : []), [briefable, related]);

  const build = useCallback(async () => {
    if (!selected) return;
    const target = { type: selected.type, id: selected.id };
    setBuilding(true);
    try {
      const res = await fetch("/api/briefings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, targetKind: target.type, targetId: target.id }),
      });
      if (res.ok) {
        const data: { briefing: BriefingCardData } = await res.json();
        // A build takes a model call, so the DM can easily type ahead before it
        // lands. Without this check the result is written into whatever card is
        // on screen now — one NPC's briefing rendered under another's name, read
        // aloud at the table as if it were theirs.
        if (selectedRef.current?.id === target.id) {
          setBriefing(data.briefing);
          setStale(false);
        }
      }
    } finally {
      setBuilding(false);
    }
  }, [selected, campaignId]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Any letter focuses search — no Cmd+K ceremony at the table.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // The stat sheet editor (and any other dialog) mounts over run mode: its fields own
      // the arrow keys and Enter, so the assistant must not hijack them.
      if (target?.closest('[role="dialog"]')) return;
      // A mouse click on a result moves focus to that button, so treat it the
      // same as the input — otherwise the arrows silently stop working the
      // moment the DM clicks instead of types.
      const inList = target?.getAttribute("role") === "option";
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || inList)) {
        if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, effectiveHits.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
        if (e.key === "ArrowRight" && effectiveRelated.length > 0) {
          e.preventDefault();
          const next = effectiveRelated[relatedCursor % effectiveRelated.length];
          if (selected) setHistory((h) => [...h, selected]);
          setOverride({ id: next.targetId, name: next.name, type: next.kind, href: "" });
          setRelatedCursor((c) => c + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setHistory((h) => {
            if (h.length === 0) { setOverride(null); return h; }
            setOverride(h[h.length - 1]);
            return h.slice(0, -1);
          });
        }
        if (e.key === "Escape") { setQuery(""); inputRef.current?.blur(); }
        if (e.key === "Enter" && selected) {
          e.preventDefault();
          const isPinned = pinned.some((p) => p.targetId === selected.id);
          if (isPinned) unpin(selected.id);
          else pin({ kind: selected.type, targetId: selected.id, name: selected.name });
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) {
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [effectiveHits.length, selected, pinned, pin, unpin, effectiveRelated, relatedCursor]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name…"
          aria-label="Search the campaign"
          className="pl-9"
        />
      </div>

      {effectiveHits.length > 0 && (
        <ul className="max-h-40 shrink-0 overflow-y-auto rounded-md border border-border" role="listbox">
          {effectiveHits.map((hit, i) => (
            <li key={`${hit.type}:${hit.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onClick={() => setCursor(i)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm",
                  i === cursor ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <span>{hit.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{hit.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {briefable && (
          <BriefingCard
            name={briefable.name}
            briefing={effectiveBriefing}
            fallback={effectiveFallback}
            stale={effectiveStale}
            pinned={pinned.some((p) => p.targetId === briefable.id)}
            onTogglePin={() =>
              pinned.some((p) => p.targetId === briefable.id)
                ? unpin(briefable.id)
                : pin({ kind: briefable.type, targetId: briefable.id, name: briefable.name })
            }
            onBuild={build}
            building={building}
          />
        )}
        {effectiveRelated.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="uppercase tracking-widest text-[10px]">Tangled up with</span>{" "}
            {effectiveRelated.map((r) => r.name).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
