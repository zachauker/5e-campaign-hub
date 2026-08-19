import { asc, eq } from "drizzle-orm";
import { sessionMarks, runSessions, type SessionMark } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

/** Ordered: keys 1-5 in /run map to these positionally. */
export const MARK_TAGS = ["npc", "promise", "loot", "lore", "todo"] as const;
export type MarkTag = (typeof MARK_TAGS)[number];

export interface CreateMarkInput {
  campaignId: string;
  runSessionId: string;
  atMs: number;
  tag?: MarkTag | null;
  note?: string | null;
  contextKind?: string | null;
  contextId?: string | null;
}

async function read(db: StateDb, id: string): Promise<SessionMark> {
  const row = await db.query.sessionMarks.findFirst({ where: eq(sessionMarks.id, id) });
  if (!row) throw new NotFoundError("No mark found with that id");
  return row;
}

export async function createMark(db: StateDb, input: CreateMarkInput): Promise<SessionMark> {
  // Object.is catches -0, which the other two checks both wave through:
  // Number.isInteger(-0) is true and -0 < 0 is false. Math.round() turns any
  // value in (-1, 0) into -0, so without this a mark timestamped a fraction of
  // a second before the run started is silently accepted as 0.
  if (!Number.isInteger(input.atMs) || input.atMs < 0 || Object.is(input.atMs, -0)) {
    throw new Error('"atMs" must be a non-negative integer');
  }
  if (input.tag != null && !(MARK_TAGS as readonly string[]).includes(input.tag)) {
    throw new Error(`Unknown mark tag "${input.tag}"`);
  }
  const run = await db.query.runSessions.findFirst({ where: eq(runSessions.id, input.runSessionId) });
  if (!run) throw new NotFoundError("No run found with that id");

  const now = new Date();
  const id = generateId();
  await db.insert(sessionMarks).values({
    id,
    campaignId: input.campaignId,
    runSessionId: input.runSessionId,
    atMs: input.atMs,
    wallClock: now,
    tag: input.tag ?? null,
    note: input.note?.trim() || null,
    contextKind: input.contextKind ?? null,
    contextId: input.contextId ?? null,
    resolved: false,
    createdAt: now,
  });
  return read(db, id);
}

export async function listMarks(db: StateDb, runSessionId: string): Promise<SessionMark[]> {
  return db.query.sessionMarks.findMany({
    where: eq(sessionMarks.runSessionId, runSessionId),
    orderBy: asc(sessionMarks.atMs),
  });
}

export async function setMarkResolved(
  db: StateDb,
  id: string,
  resolved: boolean,
): Promise<SessionMark> {
  await read(db, id);
  await db.update(sessionMarks).set({ resolved }).where(eq(sessionMarks.id, id));
  return read(db, id);
}
