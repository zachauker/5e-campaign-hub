"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ScrollText, ExternalLink, MapPin } from "lucide-react";
import { MarkdownBlocks } from "@/components/glossary/MarkdownBlocks";
import { PropsTable, type PropEntry } from "@/components/glossary/PropsTable";
import { Button } from "@/components/ui/button";
import { ReviewSlideOver } from "@/components/state/ReviewSlideOver";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useVaultName } from "@/lib/hooks/useVaultName";
import { useVaultPage } from "@/lib/hooks/useVaultPage";
import { obsidianUri } from "@/lib/vault/paths";
import type { CampaignStateView } from "@/components/state/chronicle-types";

interface DetailData {
  id: string;
  name: string;
  noteType: string | null;
  sourcePath: string | null;
  linkedLocations: { id: string; name: string; type: string }[];
  mapMarkers: { mapId: string; mapName: string; markerId: string; renderMode: "static" | "tiled" | "world" }[];
  sourceProps: PropEntry[];
}

interface ReviewStatus {
  reviewable: boolean;
  needsReview: boolean;
}

async function fetchReviewStatus(campaignId: string, sessionNoteId: string): Promise<ReviewStatus | null> {
  const res = await fetch(
    `/api/campaigns/${campaignId}/state/review/status?sessionNoteId=${encodeURIComponent(sessionNoteId)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as ReviewStatus;
}

async function fetchCampaignState(campaignId: string): Promise<CampaignStateView | null> {
  const res = await fetch(`/api/campaigns/${campaignId}/state`);
  if (!res.ok) return null;
  return (await res.json()) as CampaignStateView;
}

export function SessionNoteDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const activeCampaignId = useCampaignStore((s) => s.activeCampaignId);
  const [note, setNote] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const vaultName = useVaultName();
  const { page, error: blocksError, loading: blocksLoading } = useVaultPage(note?.sourcePath);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignStateView | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Imperative refresh after the slide-over applies something: the unreviewed
  // dot and the in-world date both move.
  const refreshReviewContext = useCallback(async () => {
    if (!activeCampaignId) return;
    const [status, state] = await Promise.all([
      fetchReviewStatus(activeCampaignId, id),
      fetchCampaignState(activeCampaignId),
    ]);
    setReviewStatus(status);
    setCampaignState(state);
  }, [activeCampaignId, id]);

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

  // Whether this note can be reviewed at all (it needs a linked vault note),
  // and whether its text has changed since the last review. Fetched alongside
  // the campaign's in-world date, which the advance dialog needs.
  useEffect(() => {
    if (!activeCampaignId) return;
    let cancelled = false;
    (async (campaignId: string) => {
      const [status, state] = await Promise.all([
        fetchReviewStatus(campaignId, id),
        fetchCampaignState(campaignId),
      ]);
      if (cancelled) return;
      setReviewStatus(status);
      setCampaignState(state);
    })(activeCampaignId);
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId, id]);

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
        {activeCampaignId && reviewStatus?.reviewable && (
          <Button
            variant={reviewStatus.needsReview ? "default" : "ghost"}
            size="sm"
            className="ml-auto flex-none"
            onClick={() => setReviewing(true)}
          >
            Review session
            {reviewStatus.needsReview && (
              <>
                <span
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-primary-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">, has unreviewed changes</span>
              </>
            )}
          </Button>
        )}
      </div>
      {note.noteType && <p className="text-sm text-muted-foreground mb-4">{note.noteType}</p>}

      {note.sourceProps.length > 0 && <PropsTable props={note.sourceProps} />}

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

      {note.sourcePath && (
        <a
          href={obsidianUri(vaultName, note.sourcePath)}
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open in Obsidian <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      <div className="mt-6 border-t border-border pt-6">
        {blocksLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {blocksError && <p className="text-sm text-muted-foreground">{blocksError}</p>}
        {page && <MarkdownBlocks blocks={page.blocks} embeds={page.embeds} />}
      </div>

      {/* Mounted fresh per open: the slide-over runs exactly one review pass on
          mount, so re-opening it must be a new mount to run a new pass. */}
      {reviewing && activeCampaignId && (
        <ReviewSlideOver
          campaignId={activeCampaignId}
          sessionNoteId={id}
          currentDay={campaignState?.currentDay ?? null}
          epochLabel={campaignState?.epochLabel ?? ""}
          onClose={() => setReviewing(false)}
          onApplied={() => void refreshReviewContext()}
        />
      )}
    </div>
  );
}
