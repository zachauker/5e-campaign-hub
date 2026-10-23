"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdvanceDateDialog } from "./AdvanceDateDialog";

interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  citation?: string;
}

type Outcome = { proposal: Proposal; ok: boolean; detail: string };

interface ReviewEvent {
  type: string;
  text?: string;
  proposal?: Proposal;
  proposalCount?: number;
  rejectedCount?: number;
  message?: string;
  contentHash?: string;
}

interface ReviewSlideOverProps {
  campaignId: string;
  sessionNoteId: string;
  currentDay: number | null;
  epochLabel: string;
  onClose: () => void;
  onApplied: () => void;
}

/** A date-advance proposal opens the advance dialog rather than POSTing blind. */
function isDateAdvance(p: Proposal): boolean {
  return p.targetRoute.endsWith("/advance-date");
}

/**
 * Consumes the review SSE stream, handing each decoded event to `onEvent`.
 * Module-level (like ChronicleBrowser's `fetchState`) so the effect below owns
 * only the state dispatch, not the transport.
 */
async function streamReview(
  campaignId: string,
  sessionNoteId: string,
  onEvent: (evt: ReviewEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/campaigns/${campaignId}/state/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionNoteId }),
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    onEvent({ type: "error", message: body.error ?? "Review failed" });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.replace(/^data: /, "").trim();
      if (!line) continue;
      onEvent(JSON.parse(line) as ReviewEvent);
    }
  }
}

/** The hash of the vault note as it stands right now, or null if unknowable. */
async function fetchCurrentHash(campaignId: string, sessionNoteId: string): Promise<string | null> {
  const res = await fetch(
    `/api/campaigns/${campaignId}/state/review/status?sessionNoteId=${encodeURIComponent(sessionNoteId)}`,
  );
  if (!res.ok) return null;
  const { currentHash } = (await res.json()) as { currentHash?: string | null };
  return currentHash ?? null;
}

/**
 * The post-session review surface. A Claude pass reads the session's vault
 * note and proposes state changes; nothing is written until the DM approves an
 * individual proposal here. Each proposal renders under the verbatim passage it
 * was derived from — that quote is the only check on the model's grounding, so
 * it is displayed, never summarised.
 */
export function ReviewSlideOver({
  campaignId,
  sessionNoteId,
  currentDay,
  epochLabel,
  onClose,
  onApplied,
}: ReviewSlideOverProps) {
  const [narration, setNarration] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [summary, setSummary] = useState<{ proposalCount: number; rejectedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // Every proposal is a POST/PATCH that creates something. Without this, a
  // double-click on Approve applies the same proposal twice — two identical
  // threads, two ticks — because nothing removes it from the list until the
  // first request comes back.
  const [applying, setApplying] = useState(false);
  const [advanceSeed, setAdvanceSeed] = useState<number | null>(null);
  const [staleWarning, setStaleWarning] = useState(false);
  const reviewedHash = useRef<string | null>(null);
  const staleAcknowledged = useRef(false);
  const started = useRef(false);

  // One review pass per mount. The ref guard — not a cleanup-flag guard — is
  // what makes this safe: StrictMode's double invoke would otherwise fire a
  // second POST (a second billed model run and a second session_reviews row),
  // and cancelling on the first cleanup would kill the only live stream. This
  // mirrors ChatPanel's `consumed` ref for the same reason.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function run() {
      try {
        await streamReview(campaignId, sessionNoteId, (evt) => {
          if (evt.type === "text" && evt.text) setNarration((t) => t + evt.text);
          else if (evt.type === "proposal" && evt.proposal) {
            const proposal = evt.proposal;
            setProposals((p) => [...p, proposal]);
          } else if (evt.type === "summary") {
            setSummary({ proposalCount: evt.proposalCount ?? 0, rejectedCount: evt.rejectedCount ?? 0 });
            reviewedHash.current = evt.contentHash ?? null;
          } else if (evt.type === "error") setError(evt.message ?? "Review failed");
        });
      } catch {
        setError("The review stream ended unexpectedly. Try again.");
      } finally {
        setBusy(false);
      }
    }
    void run();
  }, [campaignId, sessionNoteId]);

  /**
   * The background sync may have rewritten the vault note while this review was
   * open. Applying then would be applying against text the DM never read, so the
   * first attempt warns instead; a second attempt proceeds. Returns true when the
   * caller should abort.
   */
  async function guardStale(): Promise<boolean> {
    if (staleAcknowledged.current || reviewedHash.current === null) return false;
    const currentHash = await fetchCurrentHash(campaignId, sessionNoteId);
    if (currentHash === null || currentHash === reviewedHash.current) return false;
    staleAcknowledged.current = true;
    setStaleWarning(true);
    return true;
  }

  function settle(p: Proposal, ok: boolean, detail: string) {
    setProposals((list) => list.filter((x) => x !== p));
    setOutcomes((o) => [...o, { proposal: p, ok, detail }]);
  }

  /** Applies one already-staleness-checked proposal. */
  async function applyProposal(p: Proposal) {
    if (isDateAdvance(p)) {
      if (currentDay === null) {
        settle(p, false, "set the campaign's in-world date on the Chronicle first");
        return;
      }
      // Deliberately not removed from the list: the payload is a preview
      // request, and the DM still has to pick which clocks tick. The proposal
      // clears only once the dialog actually applies.
      setAdvanceSeed(Number(p.payload.toDay));
      return;
    }

    const res = await fetch(p.targetRoute, {
      method: p.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p.payload),
    });
    const ok = res.ok;
    const body = ok ? {} : ((await res.json().catch(() => ({}))) as { error?: string });
    settle(p, ok, ok ? "applied" : (body.error ?? `HTTP ${res.status}`));
    if (ok) onApplied();
  }

  async function approve(p: Proposal) {
    if (applying) return;
    setApplying(true);
    try {
      if (await guardStale()) return;
      await applyProposal(p);
    } finally {
      setApplying(false);
    }
  }

  function reject(p: Proposal) {
    settle(p, false, "rejected");
  }

  async function approveAll() {
    if (applying) return;
    setApplying(true);
    try {
      if (await guardStale()) return;
      // Sequential, not parallel: each application is independent and one failure
      // must not abort the rest.
      let openedAdvance = false;
      for (const p of [...proposals]) {
        if (isDateAdvance(p)) {
          // Only one advance dialog can be open at a time; any further date
          // proposals stay in the list for a second pass.
          if (openedAdvance) continue;
          openedAdvance = true;
        }
        await applyProposal(p);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Session review"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-semibold">Session review</span>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Amber alone would be the whole signal, so it is paired with an icon
            and screen-reader text, as on the Threads tab's staleness column. */}
        {staleWarning && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span>
              <span className="sr-only">Warning: </span>
              This vault note changed since the review ran, so these proposals were derived from
              older text. Re-run the review, or click Approve again to apply anyway.
            </span>
          </p>
        )}

        {busy && <p className="text-sm text-muted-foreground">Reading the session notes…</p>}

        {narration && (
          <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{narration}</p>
        )}

        {proposals.map((p, i) => (
          <div key={`p${i}`} className="rounded-lg border border-border p-3 text-sm">
            {/* whitespace-pre-wrap below is load-bearing, not styling. assertCitation
                stores the SOURCE's own slice, so a citation glued across two sentences
                or bullets carries the literal newline that proves the glue. HTML would
                collapse it and show the DM a seamless sentence the notes never contain
                — nullifying the only mitigation for that hazard. Do not remove it. */}
            {p.citation && (
              <figure className="mb-2">
                <figcaption className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  From the session notes
                </figcaption>
                <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                  “{p.citation}”
                </blockquote>
              </figure>
            )}
            <p className="mb-2 font-medium">{p.summary}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={applying} onClick={() => void approve(p)}>
                {isDateAdvance(p) ? "Review ticks" : applying ? "Applying…" : "Approve"}
              </Button>
              <Button size="sm" variant="ghost" disabled={applying} onClick={() => reject(p)}>
                Reject
              </Button>
            </div>
          </div>
        ))}

        {outcomes.map((o, i) => (
          <p
            key={`o${i}`}
            className={`flex items-start gap-1.5 text-xs ${o.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {o.ok ? (
              <Check className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />
            )}
            <span>
              <span className="sr-only">{o.ok ? "Applied: " : "Not applied: "}</span>
              {o.proposal.summary} — {o.detail}
            </span>
          </p>
        ))}

        {summary && !busy && (
          <p className="text-xs text-muted-foreground">
            {summary.proposalCount} proposal(s) offered
            {summary.rejectedCount > 0 &&
              `, ${summary.rejectedCount} discarded for an ungrounded citation`}
            .
          </p>
        )}

        {!busy && !error && !summary && proposals.length === 0 && outcomes.length === 0 && (
          <p className="text-sm text-muted-foreground">The review finished without proposing anything.</p>
        )}
      </div>

      {proposals.length > 1 && (
        <div className="border-t border-border p-3">
          <Button className="w-full" disabled={applying} onClick={() => void approveAll()}>
            {applying ? "Applying…" : `Approve all (${proposals.length})`}
          </Button>
        </div>
      )}

      {currentDay !== null && advanceSeed !== null && (
        <AdvanceDateDialog
          campaignId={campaignId}
          currentDay={currentDay}
          epochLabel={epochLabel}
          seedToDay={advanceSeed}
          open
          onOpenChange={(open) => !open && setAdvanceSeed(null)}
          onApplied={() => {
            setAdvanceSeed(null);
            // The advance landed, so every date proposal is now settled: the
            // first is what was applied, any others are moot at the new date.
            const advanced = proposals.filter(isDateAdvance);
            setProposals((list) => list.filter((x) => !isDateAdvance(x)));
            setOutcomes((o) => [
              ...o,
              ...advanced.map((p, i) => ({
                proposal: p,
                ok: i === 0,
                detail: i === 0 ? "applied" : "superseded by the advance above",
              })),
            ]);
            onApplied();
          }}
        />
      )}
    </div>
  );
}
