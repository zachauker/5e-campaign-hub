"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ThreadView } from "./chronicle-types";

const STATUSES = ["open", "dormant", "resolved", "abandoned"] as const;

interface ThreadFormDialogProps {
  campaignId: string;
  /** Omit to create a new thread. */
  thread?: ThreadView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }

    setBusy(true);
    const res = thread
      ? await fetch(`/api/threads/${thread.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, stakes, status }),
        })
      : await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignId, title, stakes }),
        });
    setBusy(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save the thread");
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
            <Button onClick={save} disabled={busy}>
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
