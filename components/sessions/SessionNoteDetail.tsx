"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ScrollText, ExternalLink, MapPin } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import type { NotionBlockData } from "@/lib/notion/client";

interface DetailData {
  id: string;
  name: string;
  noteType: string | null;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string; type: string }[];
  mapMarkers: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  notionProps: { label: string; value: string }[];
}

export function SessionNoteDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [note, setNote] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [blocksLoading, setBlocksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (cancelled) return;
        setNote(res.ok ? await res.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!note?.notionUrl) return;
    let cancelled = false;
    (async (url: string) => {
      setBlocksLoading(true);
      setBlocksError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/notion/page?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setBlocks(data.blocks);
        else setBlocksError(data.error ?? "Couldn't load the Notion page.");
      } finally {
        if (!cancelled) setBlocksLoading(false);
      }
    })(note.notionUrl);
    return () => {
      cancelled = true;
    };
  }, [note?.notionUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!note) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-muted-foreground">Session note not found.</p>
        <button onClick={() => router.push("/sessions")} className="text-primary hover:underline mt-2">
          Back to Sessions
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link href="/sessions" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Sessions
      </Link>
      <div className="flex items-center gap-2 mb-1">
        <ScrollText className="w-5 h-5" style={{ color: "var(--marker-event)" }} />
        <h1 className="font-display text-2xl">{note.name}</h1>
      </div>
      {note.noteType && <p className="text-sm text-muted-foreground mb-4">{note.noteType}</p>}

      {note.notionProps.length > 0 && <NotionPropsTable props={note.notionProps} />}

      {note.linkedLocations.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Settings</h2>
          <div className="flex flex-wrap gap-1.5">
            {note.linkedLocations.map((l) => (
              <Link
                key={l.id}
                href={`/locations/${l.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40"
              >
                <MapPin className="w-3 h-3" /> {l.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {note.mapMarkers.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Pinned on</h2>
          <div className="flex flex-wrap gap-1.5">
            {note.mapMarkers.map((mm) => (
              <Link
                key={mm.markerId}
                href={mm.renderMode === "world" ? `/world#marker-${mm.markerId}` : `/maps/${mm.mapId}#marker-${mm.markerId}`}
                className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40"
              >
                {mm.mapName}
              </Link>
            ))}
          </div>
        </div>
      )}

      {note.notionUrl && (
        <a
          href={note.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open in Notion <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      <div className="mt-6 border-t border-border pt-6">
        {blocksLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {blocksError && <p className="text-sm text-muted-foreground">{blocksError}</p>}
        {blocks && <NotionBlocks blocks={blocks} />}
      </div>
    </div>
  );
}
