"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Collection { id: string; name: string; sourceType: string; enabled: boolean; chunkCount: number; notes: string | null }
interface InboxFile { name: string; sizeBytes: number }

export function ReferenceLibraryPanel() {
  const [items, setItems] = useState<Collection[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inbox, setInbox] = useState<InboxFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Load on mount with a cancellation guard so a stale response can't set
  // state after the effect is torn down.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/reference/collections")
      .then((r) => r.json())
      .then((d: { items: Collection[] }) => {
        if (!cancelled) {
          const list = d.items ?? [];
          setItems(list);
          setDrafts(Object.fromEntries(list.map((c) => [c.id, c.notes ?? ""])));
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reusable reload for after an ingest completes (not a mount effect, so no
  // cancellation guard is needed here — it's only invoked imperatively).
  const loadCollections = useCallback(() => {
    fetch("/api/reference/collections")
      .then((r) => r.json())
      .then((d: { items: Collection[] }) => {
        const list = d.items ?? [];
        setItems(list);
        setDrafts(Object.fromEntries(list.map((c) => [c.id, c.notes ?? ""])));
      })
      .catch(() => {});
  }, []);

  const loadInbox = useCallback(() => {
    fetch("/api/reference/inbox")
      .then((r) => r.json())
      .then((d: { files: InboxFile[] }) => setInbox(d.files ?? []))
      .catch(() => setInbox([]));
  }, []);

  // loadInbox is a stable (empty-dep) useCallback, so calling it from an
  // effect keyed on itself satisfies the set-state-in-effect rule without
  // needing a separate cancellation flag.
  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  async function runIngest(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setProgress(null);
    setIngestError(null);
    try {
      const res = await fetch("/api/reference/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setIngestError(err.error ?? `Failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          const evt = JSON.parse(line) as { type: string; done?: number; total?: number; message?: string };
          if (evt.type === "progress") setProgress({ done: evt.done ?? 0, total: evt.total ?? 0 });
          else if (evt.type === "error") setIngestError(evt.message ?? "Ingest failed");
        }
      }
      loadCollections();
      loadInbox();
    } catch {
      setIngestError("Ingest connection failed.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function toggle(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    if (res.ok) setItems((list) => list.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)));
  }
  async function saveNotes(c: Collection) {
    const notes = drafts[c.id] ?? "";
    const res = await fetch(`/api/reference/collections/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      const saved = (await res.json()) as Collection;
      setItems((list) => list.map((x) => (x.id === c.id ? { ...x, notes: saved.notes } : x)));
    }
  }
  async function remove(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, { method: "DELETE" });
    if (res.ok) setItems((list) => list.filter((x) => x.id !== c.id));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl">Reference Library</h2>
        <p className="text-sm text-muted-foreground">
          Indexed rulebooks and lore the assistant can cite. Add sources from the Inbox below (drop files into <code>reference-inbox/</code> on the server) or Import SRD. A source&apos;s note tells the assistant what it is and how authoritative it is.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Inbox</h3>
          <span className="text-xs text-muted-foreground">drop files in reference-inbox/ on the server</span>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={!!busy} onClick={() => runIngest("SRD 5.1", { srd: true })}>
            {busy === "SRD 5.1" ? "Importing…" : "Import SRD"}
          </Button>
        </div>
        {inbox.length === 0 ? (
          <p className="text-xs text-muted-foreground">No files in the inbox.</p>
        ) : (
          <ul className="space-y-1">
            {inbox.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {f.name} <span className="text-muted-foreground">· {(f.sizeBytes / 1_000_000).toFixed(1)} MB</span>
                </span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => runIngest(f.name, { file: f.name })}>
                  {busy === f.name ? "Ingesting…" : "Ingest"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {busy && progress && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
        )}
        {ingestError && <p className="text-xs text-red-500">{ingestError}</p>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources indexed yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((c) => {
            const dirty = (drafts[c.id] ?? "") !== (c.notes ?? "");
            return (
              <li key={c.id} className="space-y-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    {c.name} <span className="text-muted-foreground">· {c.sourceType} · {c.chunkCount} chunks</span>
                  </span>
                  <Button size="sm" variant={c.enabled ? "default" : "ghost"} onClick={() => toggle(c)}>
                    {c.enabled ? "Enabled" : "Disabled"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                    Delete
                  </Button>
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    rows={2}
                    placeholder="Context for the assistant, e.g. “official Wildemount setting book; authoritative for setting/lore”"
                    value={drafts[c.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saveNotes(c)}>
                    Save note
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
