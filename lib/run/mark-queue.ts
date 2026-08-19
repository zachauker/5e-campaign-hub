import type { MarkTag } from "./marks";

/** Backoff bounds. A mark is never dropped — the ceiling only stops the delay growing. */
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

export interface QueuedMark {
  /** Client-generated so a retry can never write the same mark twice. */
  localId: string;
  campaignId: string;
  runSessionId: string;
  atMs: number;
  tag: MarkTag | null;
  note: string | null;
  contextKind: string | null;
  contextId: string | null;
  attempts: number;
  nextAttemptAt: number;
}

export function enqueue(queue: QueuedMark[], item: QueuedMark): QueuedMark[] {
  if (queue.some((q) => q.localId === item.localId)) return queue;
  return [...queue, item];
}

export function markSent(queue: QueuedMark[], localId: string): QueuedMark[] {
  return queue.filter((q) => q.localId !== localId);
}

/**
 * Record a failed attempt and schedule the next one. The item stays in the
 * queue no matter how many attempts fail: a mark that vanishes because the
 * server was down for a minute is the one failure mode this feature cannot
 * have.
 */
export function markFailed(queue: QueuedMark[], localId: string, now: number): QueuedMark[] {
  return queue.map((q) => {
    if (q.localId !== localId) return q;
    const attempts = q.attempts + 1;
    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    return { ...q, attempts, nextAttemptAt: now + delay };
  });
}

export function dueItems(queue: QueuedMark[], now: number): QueuedMark[] {
  return queue.filter((q) => q.nextAttemptAt <= now);
}

export function serialise(queue: QueuedMark[]): string {
  return JSON.stringify(queue);
}

function isQueuedMark(v: unknown): v is QueuedMark {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.localId === "string" &&
    typeof o.campaignId === "string" &&
    typeof o.runSessionId === "string" &&
    typeof o.atMs === "number" &&
    typeof o.attempts === "number" &&
    typeof o.nextAttemptAt === "number"
  );
}

/** Never throws: a corrupt blob must not stop the run from starting. */
export function deserialise(raw: string | null): QueuedMark[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedMark) : [];
  } catch {
    return [];
  }
}
