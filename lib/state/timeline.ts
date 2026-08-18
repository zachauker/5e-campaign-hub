import { timelineEvents } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import type { StateDb } from "./types";

export type TimelineKind =
  | "thread_opened"
  | "thread_resolved"
  | "clock_ticked"
  | "clock_completed"
  | "date_advanced"
  | "session_played"
  | "note";

export type SourceKind = "manual" | "proposal" | "cadence";

export interface RecordEventInput {
  campaignId: string;
  day: number | null;
  kind: TimelineKind;
  title: string;
  body?: string | null;
  sourceKind?: SourceKind;
  threadId?: string | null;
  clockId?: string | null;
}

/**
 * Append one timeline event. A null `day` means the campaign has no in-world
 * date yet, so the event has no position on the timeline and is skipped rather
 * than being written at a fabricated day 0.
 */
export async function recordEvent(db: StateDb, input: RecordEventInput): Promise<void> {
  if (input.day === null) return;
  await db.insert(timelineEvents).values({
    id: generateId(),
    campaignId: input.campaignId,
    day: input.day,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    sourceKind: input.sourceKind ?? "manual",
    threadId: input.threadId ?? null,
    clockId: input.clockId ?? null,
    createdAt: new Date(),
  });
}
