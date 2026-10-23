// components/maps/EventNoteBody.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink } from "lucide-react";
import { MarkdownBlocks } from "@/components/glossary/MarkdownBlocks";
import type { ResolvedMarker } from "@/components/maps/map-types";
import { useVaultName } from "@/lib/hooks/useVaultName";
import { useVaultPage } from "@/lib/hooks/useVaultPage";
import { obsidianUri } from "@/lib/vault/paths";

interface NoteDetail {
  id: string;
  name: string;
  sourcePath: string | null;
  linkedLocations: { id: string; name: string }[];
}

/** Body for an event (session-note) pin: linked settings, the vault note body,
 *  and an "Open in Obsidian" link. Fetched on open. Rendered inside MarkerSlideOver. */
export function EventNoteBody({ marker }: { marker: ResolvedMarker }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const vaultName = useVaultName();
  const { page, error: pageError, loading: pageLoading } = useVaultPage(detail?.sourcePath);
  const error = detailError ?? pageError;
  const loading = detailLoading || pageLoading;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!marker.entityId) {
        if (!cancelled) {
          // Clear the previous pin's note: the slide-over reuses this component across markers.
          setDetail(null);
          setDetailLoading(false);
          setDetailError("Session note not found.");
        }
        return;
      }
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const res = await fetch(`/api/sessions/${marker.entityId}`);
        if (!res.ok) {
          if (!cancelled) setDetailError("Session note not found.");
          return;
        }
        const d: NoteDetail = await res.json();
        if (!cancelled) setDetail(d);
      } finally {
        if (!cancelled) setDetailLoading(false);
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
      {detail?.sourcePath && (
        <a
          href={obsidianUri(vaultName, detail.sourcePath)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open in Obsidian <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {page && <MarkdownBlocks blocks={page.blocks} embeds={page.embeds} links={page.links} />}
      {!loading && !error && !page && detail && !detail.sourcePath && (
        <p className="text-sm text-muted-foreground">No vault note linked.</p>
      )}
    </div>
  );
}
