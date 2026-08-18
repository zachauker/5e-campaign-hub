import { and, eq, inArray } from "drizzle-orm";
import { threads, threadLinks } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { recordEvent, type SourceKind } from "./timeline";
import type { StateDb } from "./types";

export type ThreadStatus = "open" | "dormant" | "resolved" | "abandoned";
export const THREAD_STATUSES: ThreadStatus[] = ["open", "dormant", "resolved", "abandoned"];

export type ThreadTargetKind = "character" | "location" | "item" | "faction" | "session";
export type ThreadLinkRole = "subject" | "stakeholder" | "obstacle";

export interface ThreadLinkInput {
  targetKind: ThreadTargetKind;
  targetId: string;
  role?: ThreadLinkRole;
}

export interface CreateThreadInput {
  campaignId: string;
  title: string;
  stakes?: string | null;
  notes?: string | null;
  openedSessionId?: string | null;
  currentDay: number | null;
  links?: ThreadLinkInput[];
  sourceKind?: SourceKind;
}

export interface UpdateThreadInput {
  title?: string;
  stakes?: string | null;
  notes?: string | null;
  status?: ThreadStatus;
  resolvedSessionId?: string | null;
  currentDay: number | null;
  links?: ThreadLinkInput[];
}

export interface ThreadWithLinks {
  id: string;
  campaignId: string;
  title: string;
  stakes: string | null;
  status: string;
  openedOnDay: number | null;
  lastTouchedDay: number | null;
  notes: string | null;
  openedSessionId: string | null;
  resolvedSessionId: string | null;
  daysUntouched: number | null;
  links: Array<{ targetKind: string; targetId: string; role: string }>;
}

export async function createThread(db: StateDb, input: CreateThreadInput) {
  const title = input.title.trim();
  if (!title) throw new Error("thread title is required");

  const now = new Date();
  const id = generateId();

  const [row] = await db
    .insert(threads)
    .values({
      id,
      campaignId: input.campaignId,
      title,
      stakes: input.stakes ?? null,
      notes: input.notes ?? null,
      status: "open",
      openedSessionId: input.openedSessionId ?? null,
      openedOnDay: input.currentDay,
      lastTouchedDay: input.currentDay,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await writeLinks(db, id, input.links ?? []);

  await recordEvent(db, {
    campaignId: input.campaignId,
    day: input.currentDay,
    kind: "thread_opened",
    title,
    body: input.stakes ?? null,
    sourceKind: input.sourceKind ?? "manual",
    threadId: id,
  });

  return row;
}

export async function updateThread(db: StateDb, id: string, input: UpdateThreadInput) {
  const existing = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!existing) throw new Error(`thread not found: ${id}`);

  if (input.status && !THREAD_STATUSES.includes(input.status)) {
    throw new Error(`invalid thread status: ${input.status}`);
  }

  const [row] = await db
    .update(threads)
    .set({
      title: input.title?.trim() || existing.title,
      stakes: input.stakes === undefined ? existing.stakes : input.stakes,
      notes: input.notes === undefined ? existing.notes : input.notes,
      status: input.status ?? existing.status,
      resolvedSessionId:
        input.resolvedSessionId === undefined ? existing.resolvedSessionId : input.resolvedSessionId,
      lastTouchedDay: input.currentDay ?? existing.lastTouchedDay,
      updatedAt: new Date(),
    })
    .where(eq(threads.id, id))
    .returning();

  if (input.links) {
    await db.delete(threadLinks).where(eq(threadLinks.threadId, id));
    await writeLinks(db, id, input.links);
  }

  if (input.status === "resolved" && existing.status !== "resolved") {
    await recordEvent(db, {
      campaignId: existing.campaignId,
      day: input.currentDay,
      kind: "thread_resolved",
      title: row.title,
      sourceKind: "manual",
      threadId: id,
    });
  }

  return row;
}

export interface ListThreadsOpts {
  currentDay: number | null;
  includeResolved?: boolean;
  includeArchived?: boolean;
}

export async function listThreads(
  db: StateDb,
  campaignId: string,
  opts: ListThreadsOpts,
): Promise<ThreadWithLinks[]> {
  const rows = await db.query.threads.findMany({ where: eq(threads.campaignId, campaignId) });

  const visible = rows.filter((r) => {
    if (!opts.includeArchived && r.archived) return false;
    if (!opts.includeResolved && (r.status === "resolved" || r.status === "abandoned")) return false;
    return true;
  });

  const links = visible.length
    ? await db.query.threadLinks.findMany({ where: inArray(threadLinks.threadId, visible.map((r) => r.id)) })
    : [];

  const decorated = visible.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    title: r.title,
    stakes: r.stakes,
    status: r.status,
    openedOnDay: r.openedOnDay,
    lastTouchedDay: r.lastTouchedDay,
    notes: r.notes,
    openedSessionId: r.openedSessionId,
    resolvedSessionId: r.resolvedSessionId,
    daysUntouched:
      opts.currentDay === null || r.lastTouchedDay === null ? null : opts.currentDay - r.lastTouchedDay,
    links: links
      .filter((l) => l.threadId === r.id)
      .map((l) => ({ targetKind: l.targetKind, targetId: l.targetId, role: l.role })),
  }));

  // Most stale first; unknown staleness sinks to the bottom, then by title for stability.
  decorated.sort((a, b) => {
    if (a.daysUntouched === b.daysUntouched) return a.title.localeCompare(b.title);
    if (a.daysUntouched === null) return 1;
    if (b.daysUntouched === null) return -1;
    return b.daysUntouched - a.daysUntouched;
  });

  return decorated;
}

/** Open threads linked to one entity — powers the inline block on detail pages. */
export async function listThreadsForTarget(
  db: StateDb,
  campaignId: string,
  targetKind: ThreadTargetKind,
  targetId: string,
  currentDay: number | null,
): Promise<ThreadWithLinks[]> {
  const matches = await db.query.threadLinks.findMany({
    where: and(eq(threadLinks.targetKind, targetKind), eq(threadLinks.targetId, targetId)),
  });
  if (!matches.length) return [];

  const ids = new Set(matches.map((m) => m.threadId));
  const all = await listThreads(db, campaignId, { currentDay });
  return all.filter((t) => ids.has(t.id));
}

async function writeLinks(db: StateDb, threadId: string, links: ThreadLinkInput[]): Promise<void> {
  for (const link of links) {
    await db.insert(threadLinks).values({
      id: generateId(),
      threadId,
      targetKind: link.targetKind,
      targetId: link.targetId,
      role: link.role ?? "subject",
    });
  }
}
