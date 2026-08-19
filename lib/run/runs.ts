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
  const id = generateId();

  // Closing the old run and opening the new one are one operation. Awaiting
  // between them yields to the event loop, and POST /api/runs is reachable
  // twice in quick succession — a double-click entering run mode, a retry, or
  // React re-invoking the start effect. Interleaved, two requests each close
  // nothing and insert one, leaving two open runs in a campaign and defeating
  // the very invariant the close exists to enforce.
  db.transaction((tx) => {
    tx
      .update(runSessions)
      .set({ endedAt: now })
      .where(and(eq(runSessions.campaignId, input.campaignId), isNull(runSessions.endedAt)))
      .run();

    tx.insert(runSessions).values({
      id,
      campaignId: input.campaignId,
      label: input.label ?? null,
      startedAt: now,
      endedAt: null,
      sessionNoteId: null,
      createdAt: now,
    }).run();
  });

  return read(db, id);
}

export async function getActiveRun(db: StateDb, campaignId: string): Promise<RunSession | null> {
  const row = await db.query.runSessions.findFirst({
    where: and(eq(runSessions.campaignId, campaignId), isNull(runSessions.endedAt)),
    // id breaks a startedAt tie deterministically — these timestamps are
    // second-resolution, so two runs opened in the same second are ordinary.
    orderBy: [desc(runSessions.startedAt), desc(runSessions.id)],
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
    // id breaks a startedAt tie deterministically — these timestamps are
    // second-resolution, so two runs opened in the same second are ordinary.
    orderBy: [desc(runSessions.startedAt), desc(runSessions.id)],
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
