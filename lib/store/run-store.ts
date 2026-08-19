import { create } from "zustand";
import type { MarkTag } from "@/lib/run/marks";
import {
  enqueue, markSent, markFailed, dueItems, serialise, deserialise, type QueuedMark,
} from "@/lib/run/mark-queue";

const STORAGE_KEY = "run-mark-queue";

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
  lastError: string | null;

  beginRun: (runSessionId: string, startedAt: number) => void;
  endRunLocal: () => void;
  pin: (card: PinnedCard) => void;
  unpin: (targetId: string) => void;
  addMark: (input: Omit<QueuedMark, "attempts" | "nextAttemptAt">) => void;
  tagLastMark: (tag: MarkTag) => void;
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
  lastError: null,

  beginRun: (runSessionId, startedAt) => set({ runSessionId, startedAt, sent: [], lastError: null }),
  endRunLocal: () => set({ runSessionId: null, startedAt: null, pinned: [] }),

  pin: (card) =>
    set((s) =>
      s.pinned.some((p) => p.targetId === card.targetId) ? s : { pinned: [...s.pinned, card] },
    ),
  unpin: (targetId) => set((s) => ({ pinned: s.pinned.filter((p) => p.targetId !== targetId) })),

  addMark: (input) => {
    const item: QueuedMark = { ...input, attempts: 0, nextAttemptAt: 0 };
    const queue = enqueue(get().queue, item);
    persist(queue);
    set({ queue });
    void get().flush();
  },

  // Applies to the most recent queued mark. The tag window is a UI concern; by
  // the time a mark has been accepted it is no longer taggable from the strip.
  tagLastMark: (tag) => {
    const queue = get().queue;
    if (queue.length === 0) return;
    const next = queue.map((q, i) => (i === queue.length - 1 ? { ...q, tag } : q));
    persist(next);
    set({ queue: next });
  },

  flush: async () => {
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
  },

  restoreQueue: () => {
    if (typeof window === "undefined") return;
    const queue = deserialise(window.localStorage.getItem(STORAGE_KEY));
    if (queue.length > 0) set({ queue });
  },
}));
