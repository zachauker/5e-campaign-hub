"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ENTITY_KIND_LABELS,
  STATE_ENTITY_KINDS,
  fetchEntityOptions,
  type EntityOptions,
  type StateEntityKind,
} from "./entity-options";
import type { ThreadView } from "./chronicle-types";

const STATUSES = ["open", "dormant", "resolved", "abandoned"] as const;

/** Mirrors THREAD_LINK_ROLES in lib/state/threads.ts, which validates the write. */
const ROLES = ["subject", "stakeholder", "obstacle"] as const;

const ROLE_HINTS: Record<(typeof ROLES)[number], string> = {
  subject: "the thread is about them",
  stakeholder: "they care how it lands",
  obstacle: "they are in the way",
};

interface LinkDraft {
  targetKind: string;
  targetId: string;
  role: string;
}

interface ThreadFormDialogProps {
  campaignId: string;
  /** Omit to create a new thread. */
  thread?: ThreadView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function isEditableKind(kind: string): kind is StateEntityKind {
  return (STATE_ENTITY_KINDS as string[]).includes(kind);
}

/**
 * Seeds its fields from props via `useState`, so callers must mount it FRESH per
 * edit (render it conditionally) rather than keeping it mounted and toggling
 * `open` — otherwise a second edit shows the first thread's values.
 */
export function ThreadFormDialog({ campaignId, thread, open, onOpenChange, onSaved }: ThreadFormDialogProps) {
  const [title, setTitle] = useState(thread?.title ?? "");
  const [stakes, setStakes] = useState(thread?.stakes ?? "");
  const [status, setStatus] = useState<string>(thread?.status ?? "open");
  const [links, setLinks] = useState<LinkDraft[]>(
    (thread?.links ?? []).map((l) => ({ targetKind: l.targetKind, targetId: l.targetId, role: l.role })),
  );
  const [options, setOptions] = useState<EntityOptions>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cancellation-guarded async inside the effect (not `void load()` on a
  // useCallback), matching ChronicleBrowser.tsx — this repo's
  // react-hooks/set-state-in-effect rule rejects the latter.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const result = await fetchEntityOptions(campaignId, STATE_ENTITY_KINDS);
      if (cancelled) return;
      if (result.ok) {
        setOptions(result.options);
        setOptionsError(null);
      } else {
        setOptionsError(result.error);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  function patchLink(index: number, patch: Partial<LinkDraft>) {
    setLinks((list) => list.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLink(index: number) {
    setLinks((list) => list.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }

    const incomplete = links.findIndex((l) => !l.targetKind || !l.targetId);
    if (incomplete !== -1) {
      setError(`Link ${incomplete + 1} needs both a kind and an entity — pick one or remove the row.`);
      return;
    }

    setBusy(true);
    // `links` is always sent, including as an empty array: updateThread rewrites
    // the link set only when the key is present, so omitting it on an edit that
    // cleared every link would silently keep the old ones.
    const res = thread
      ? await fetch(`/api/threads/${thread.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, stakes, status, links }),
        })
      : await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignId, title, stakes, links }),
        });
    setBusy(false);

    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save the thread");
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{thread ? "Edit thread" : "Open a thread"}</DialogTitle>
          <DialogDescription>
            A thread is an open question the table cares about, plus what goes wrong if it is never answered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              The question (e.g. &ldquo;Who hired the assassins?&rdquo;)
            </span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Stakes — what goes wrong if it stays open</span>
            <Input value={stakes} onChange={(e) => setStakes(e.target.value)} />
          </label>

          <div className="space-y-2">
            <span className="block text-sm text-muted-foreground">
              Who this touches — linked entities show this thread on their own page
            </span>

            {links.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Not linked to anything yet, so it will only appear on the chronicle.
              </p>
            )}

            <ul className="space-y-2">
              {links.map((link, i) => {
                const editKind = isEditableKind(link.targetKind) ? link.targetKind : null;
                const list = editKind ? (options[editKind] ?? []) : [];
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    {editKind ? (
                      <>
                        <select
                          aria-label={`Link ${i + 1} kind`}
                          className="w-28 flex-none rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          value={link.targetKind}
                          onChange={(e) => patchLink(i, { targetKind: e.target.value, targetId: "" })}
                        >
                          {STATE_ENTITY_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {ENTITY_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label={`Link ${i + 1} entity`}
                          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          value={link.targetId}
                          onChange={(e) => patchLink(i, { targetId: e.target.value })}
                        >
                          <option value="">Choose…</option>
                          {/* A link the AI made can point at an entity missing from
                              this list (archived, or deleted — thread_links do not
                              cascade). Keep the id selectable so editing another row
                              does not silently drop it. */}
                          {link.targetId && !list.some((o) => o.id === link.targetId) && (
                            <option value={link.targetId}>(unknown — {link.targetId})</option>
                          )}
                          {list.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label={`Link ${i + 1} role`}
                          className="w-32 flex-none rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          value={link.role}
                          onChange={(e) => patchLink(i, { role: e.target.value })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      // A kind this editor does not offer (a session link from a
                      // review pass). Shown read-only and passed through on save
                      // rather than silently rewritten to something else.
                      <span className="flex-1 truncate text-sm text-muted-foreground">
                        {link.targetKind} · {link.role} · {link.targetId}
                      </span>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove link ${i + 1}`}
                      onClick={() => removeLink(i)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>

            {/* Button and hint stacked, not side by side: the hint is long
                enough that a flex row squeezes the button to two lines and
                pushes the dialog into a horizontal scroll. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLinks((list) => [...list, { targetKind: "faction", targetId: "", role: "subject" }])}
            >
              Add a link
            </Button>
            <p className="text-xs text-muted-foreground">
              {ROLES.map((r) => `${r}: ${ROLE_HINTS[r]}`).join(" · ")}
            </p>

            {optionsError && (
              <p role="alert" className="text-sm text-destructive">
                {optionsError} The entity lists may be incomplete.
              </p>
            )}
          </div>

          {thread && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Status</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
