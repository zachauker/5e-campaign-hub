// components/maps/EventNoteBody.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import type { ResolvedMarker } from "@/components/maps/map-types";
import type { NotionBlockData } from "@/lib/notion/client";

interface NoteDetail {
  id: string;
  name: string;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string }[];
  notionProps: { label: string; value: string }[];
}

/** Body for an event (session-note) pin: linked settings, the Notion page body,
 *  and a "View in Notion" link. Fetched on open. Rendered inside MarkerSlideOver. */
export function EventNoteBody({ marker }: { marker: ResolvedMarker }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!marker.entityId) {
        if (!cancelled) {
          setLoading(false);
          setError("Session note not found.");
        }
        return;
      }
      setLoading(true);
      setError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/sessions/${marker.entityId}`);
        if (!res.ok) {
          if (!cancelled) setError("Session note not found.");
          return;
        }
        const d: NoteDetail = await res.json();
        if (cancelled) return;
        setDetail(d);
        if (d.notionUrl) {
          const pageRes = await fetch(`/api/notion/page?url=${encodeURIComponent(d.notionUrl)}`);
          const pageData = await pageRes.json();
          if (cancelled) return;
          if (pageRes.ok) setBlocks(pageData.blocks);
          else setError(pageData.error ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marker.entityId]);

  return (
    <div className="space-y-3">
      {detail?.linkedLocations && detail.linkedLocations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detail.linkedLocations.map((l) => (
            <Link
              key={l.id}
              href={`/locations/${l.id}`}
              className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40"
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}
      {detail?.notionUrl && (
        <a
          href={detail.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View in Notion <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {blocks && <NotionBlocks blocks={blocks} />}
      {!loading && !error && !blocks && detail && !detail.notionUrl && (
        <p className="text-sm text-muted-foreground">No Notion page linked.</p>
      )}
    </div>
  );
}
