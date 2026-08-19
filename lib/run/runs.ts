import { and, desc, eq, isNull } from "drizzle-orm";
import { runSessions, type RunSession } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

async function read(db: StateDb, id: string): Promise<RunSession> {
  const row = await db.query.runSessions.findFirst({ where: eq(runSessions.id, id) });
  if (!row) throw new NotFoundError("No run found with that id");
  return row;
}

/**
 * Open a run. Any run left open in this campaign is closed first — a DM who
 * forgets to end a session should not have tonight's marks land on last week's
 * run.
 */
export async function startRun(
  db: StateDb,
  input: { campaignId: string; label?: string | null },
): Promise<RunSession> {
  const now = new Date();
  await db
    .update(runSessions)
    .set({ endedAt: now })
    .where(and(eq(runSessions.campaignId, input.campaignId), isNull(runSessions.endedAt)));

  const id = generateId();
  await db.insert(runSessions).values({
    id,
    campaignId: input.campaignId,
    label: input.label ?? null,
    startedAt: now,
    endedAt: null,
    sessionNoteId: null,
    createdAt: now,
  });
  return read(db, id);
}

export async function getActiveRun(db: StateDb, campaignId: string): Promise<RunSession | null> {
  const row = await db.query.runSessions.findFirst({
    where: and(eq(runSessions.campaignId, campaignId), isNull(runSessions.endedAt)),
    orderBy: desc(runSessions.startedAt),
  });
  return row ?? null;
}

/** Idempotent: re-ending a closed run keeps the original timestamp. */
export async function endRun(db: StateDb, id: string): Promise<RunSession> {
  const run = await read(db, id);
  if (run.endedAt) return run;
  await db.update(runSessions).set({ endedAt: new Date() }).where(eq(runSessions.id, id));
  return read(db, id);
}

export async function listRuns(db: StateDb, campaignId: string): Promise<RunSession[]> {
  return db.query.runSessions.findMany({
    where: eq(runSessions.campaignId, campaignId),
    orderBy: desc(runSessions.startedAt),
  });
}

/** Link the run to the session note whose transcript covers it. */
export async function linkSessionNote(
  db: StateDb,
  id: string,
  sessionNoteId: string | null,
): Promise<RunSession> {
  await read(db, id);
  await db.update(runSessions).set({ sessionNoteId }).where(eq(runSessions.id, id));
  return read(db, id);
}
