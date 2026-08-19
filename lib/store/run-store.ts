import { create } from "zustand";
import type { MarkTag } from "@/lib/run/marks";
import {
  enqueue, markSent, markFailed, dueItems, serialise, deserialise, TAG_WINDOW_MS, type QueuedMark,
} from "@/lib/run/mark-queue";

const STORAGE_KEY = "run-mark-queue";

// Module-level, not component state: the store is a singleton, and this
// guards against two overlapping flush() calls (e.g. the interval timer
// firing again before a slow fetch resolves) reading the same queue snapshot
// and double-POSTing, or a late set() built from a stale snapshot resurrecting
// a mark that already sent.
let flushing = false;

export interface PinnedCard {
  kind: string;
  targetId: string;
  name: string;
}

interface RunState {
  runSessionId: string | null;
  startedAt: number | null;
  pinned: PinnedCard[];
  queue: QueuedMark[];
  /** Marks accepted by the server this run, newest last. Drives the bottom strip. */
  sent: { localId: string; atMs: number; tag: MarkTag | null }[];
  /**
   * localId of the mark the tag window is currently open for, or null. This
   * is the mark digit keys 1-5 (and MarkStrip's tag buttons) apply to — set
   * by addMark, and the only thing that identifies "the mark just made" once
   * other marks may have entered or left the queue since.
   */
  taggableLocalId: string | null;
  lastError: string | null;

  beginRun: (runSessionId: string, startedAt: number) => void;
  endRunLocal: () => void;
  pin: (card: PinnedCard) => void;
  unpin: (targetId: string) => void;
  addMark: (input: Omit<QueuedMark, "attempts" | "nextAttemptAt">) => void;
  tagMark: (localId: string, tag: MarkTag) => void;
  clearTaggable: () => void;
  flush: () => Promise<void>;
  restoreQueue: () => void;
}

function persist(queue: QueuedMark[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialise(queue));
  } catch {
    // Storage full or blocked. The in-memory queue still retries; losing the
    // crash-recovery copy is worse than nothing but not worth failing the mark.
  }
}

export const useRunStore = create<RunState>((set, get) => ({
  runSessionId: null,
  startedAt: null,
  pinned: [],
  queue: [],
  sent: [],
  taggableLocalId: null,
  lastError: null,

  beginRun: (runSessionId, startedAt) => set({ runSessionId, startedAt, sent: [], lastError: null }),
  endRunLocal: () => set({ runSessionId: null, startedAt: null, pinned: [] }),

  pin: (card) =>
    set((s) =>
      s.pinned.some((p) => p.targetId === card.targetId) ? s : { pinned: [...s.pinned, card] },
    ),
  unpin: (targetId) => set((s) => ({ pinned: s.pinned.filter((p) => p.targetId !== targetId) })),

  addMark: (input) => {
    // Not due until the tag window closes. This guarantees the mark is still
    // sitting in the queue for the whole window a DM has to tag it, so
    // tagMark's lookup-by-localId always has something to find. Sending it
    // immediately would let a fast flush() remove it from the queue mid-window,
    // which is what let tagging-by-position land on the wrong mark before —
    // resist "fixing" this back to an immediate send.
    const item: QueuedMark = { ...input, attempts: 0, nextAttemptAt: Date.now() + TAG_WINDOW_MS };
    const queue = enqueue(get().queue, item);
    persist(queue);
    set({ queue, taggableLocalId: item.localId });
    // No immediate flush: the interval flush (see app/run/page.tsx) picks
    // this up once it becomes due. Crash safety is unaffected — persist()
    // above already wrote it to localStorage synchronously.
  },

  // Tags by identity, not queue position: an earlier mark can still be
  // sitting in the queue (backed off after a failed send) when a new one is
  // made, so "the last item in the queue" is not reliably "the mark just
  // made". localId is the only stable handle on that.
  tagMark: (localId, tag) => {
    const queue = get().queue.map((q) => (q.localId === localId ? { ...q, tag } : q));
    persist(queue);
    set((s) => ({
      queue,
      taggableLocalId: s.taggableLocalId === localId ? null : s.taggableLocalId,
    }));
  },

  clearTaggable: () => set({ taggableLocalId: null }),

  flush: async () => {
    if (flushing) return;
    flushing = true;
    try {
      const now = Date.now();
      for (const item of dueItems(get().queue, now)) {
        try {
          const res = await fetch("/api/marks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(item),
          });
          if (!res.ok) throw new Error(`Mark write failed (${res.status})`);
          const queue = markSent(get().queue, item.localId);
          persist(queue);
          set((s) => ({
            queue,
            sent: [...s.sent, { localId: item.localId, atMs: item.atMs, tag: item.tag }],
            lastError: null,
          }));
        } catch (err) {
          const queue = markFailed(get().queue, item.localId, Date.now());
          persist(queue);
          set({ queue, lastError: err instanceof Error ? err.message : "Mark write failed" });
        }
      }
    } finally {
      flushing = false;
    }
  },

  restoreQueue: () => {
    if (typeof window === "undefined") return;
    const queue = deserialise(window.localStorage.getItem(STORAGE_KEY));
    if (queue.length > 0) set({ queue });
  },
}));
