import { and, eq } from "drizzle-orm";
import { entityBriefings } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { NotFoundError } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";
import { indexBriefing, type SearchKind } from "./search-index";

export type BriefingTargetKind = "character" | "location" | "item" | "faction";

// Derived from BriefingTargetKind via an exhaustiveness check: the Record
// literal must have exactly one key per union member, so adding a member
// without updating this record is a compile error.
const TARGET_KIND_SET: Record<BriefingTargetKind, true> = {
  character: true,
  location: true,
  item: true,
  faction: true,
};
export const BRIEFING_TARGET_KINDS = Object.keys(TARGET_KIND_SET) as BriefingTargetKind[];

/** The fields a build writes and the DM may override. Never includes sourceHash or partial. */
export const BRIEFING_FIELDS = [
  "identity", "wants", "partyKnows", "secret", "voice", "aliases",
] as const;
export type BriefingField = (typeof BRIEFING_FIELDS)[number];

export interface Briefing {
  id: string;
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  aliases: string[];
  sourceHash: string;
  manualFields: BriefingField[];
  partial: boolean;
  builtAt: Date;
}

export interface UpsertBriefingInput {
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  identity?: string | null;
  wants?: string | null;
  partyKnows?: string | null;
  secret?: string | null;
  voice?: string | null;
  aliases?: string[];
  sourceHash: string;
  partial?: boolean;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toBriefing(row: typeof entityBriefings.$inferSelect): Briefing {
  return {
    id: row.id,
    campaignId: row.campaignId,
    targetKind: row.targetKind as BriefingTargetKind,
    targetId: row.targetId,
    identity: row.identity,
    wants: row.wants,
    partyKnows: row.partyKnows,
    secret: row.secret,
    voice: row.voice,
    aliases: parseStringArray(row.aliases),
    sourceHash: row.sourceHash,
    manualFields: parseStringArray(row.manualFields) as BriefingField[],
    partial: row.partial,
    builtAt: row.builtAt,
  };
}

function assertTargetKind(kind: string): asserts kind is BriefingTargetKind {
  if (!(BRIEFING_TARGET_KINDS as string[]).includes(kind)) {
    throw new Error(`Unknown targetKind "${kind}"`);
  }
}

async function readRow(db: StateDb, campaignId: string, targetKind: string, targetId: string) {
  return db.query.entityBriefings.findFirst({
    where: and(
      eq(entityBriefings.campaignId, campaignId),
      eq(entityBriefings.targetKind, targetKind),
      eq(entityBriefings.targetId, targetId),
    ),
  });
}

export async function getBriefing(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
): Promise<Briefing | null> {
  const row = await readRow(db, campaignId, targetKind, targetId);
  return row ? toBriefing(row) : null;
}

async function syncIndex(db: StateDb, b: Briefing): Promise<void> {
  await indexBriefing(db, {
    campaignId: b.campaignId,
    kind: b.targetKind as SearchKind,
    targetId: b.targetId,
    aliases: b.aliases,
    identity: b.identity,
    wants: b.wants,
    partyKnows: b.partyKnows,
  });
}

/**
 * Write a built briefing. Fields listed in `manualFields` are preserved exactly
 * as the DM left them — a rebuild that silently overwrote a hand-written voice
 * line would make the whole feature untrustworthy.
 */
export async function upsertBriefing(db: StateDb, input: UpsertBriefingInput): Promise<Briefing> {
  assertTargetKind(input.targetKind);
  const now = new Date();
  const existing = await readRow(db, input.campaignId, input.targetKind, input.targetId);
  const manual = existing ? (parseStringArray(existing.manualFields) as BriefingField[]) : [];
  const keep = (field: BriefingField) => manual.includes(field);

  const values = {
    identity: keep("identity") ? existing!.identity : (input.identity ?? null),
    wants: keep("wants") ? existing!.wants : (input.wants ?? null),
    partyKnows: keep("partyKnows") ? existing!.partyKnows : (input.partyKnows ?? null),
    secret: keep("secret") ? existing!.secret : (input.secret ?? null),
    voice: keep("voice") ? existing!.voice : (input.voice ?? null),
    aliases: keep("aliases") ? existing!.aliases : JSON.stringify(input.aliases ?? []),
    sourceHash: input.sourceHash,
    partial: input.partial ?? false,
    builtAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db.update(entityBriefings).set(values).where(eq(entityBriefings.id, existing.id));
  } else {
    await db.insert(entityBriefings).values({
      id: generateId(),
      campaignId: input.campaignId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      manualFields: "[]",
      createdAt: now,
      ...values,
    });
  }

  const written = await readRow(db, input.campaignId, input.targetKind, input.targetId);
  const briefing = toBriefing(written!);
  await syncIndex(db, briefing);
  return briefing;
}

/**
 * Apply DM edits and mark each edited field as manual so future rebuilds leave
 * it alone.
 */
export async function setManualFields(
  db: StateDb,
  campaignId: string,
  targetKind: string,
  targetId: string,
  edits: Partial<Record<BriefingField, string | string[] | null>>,
): Promise<Briefing> {
  const existing = await readRow(db, campaignId, targetKind, targetId);
  if (!existing) throw new NotFoundError("Briefing not found for that target");

  const manual = new Set(parseStringArray(existing.manualFields) as BriefingField[]);
  const values: Record<string, unknown> = { updatedAt: new Date() };

  for (const [field, value] of Object.entries(edits)) {
    if (!(BRIEFING_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`"${field}" is not a briefing field`);
    }
    manual.add(field as BriefingField);
    values[field] = field === "aliases" ? JSON.stringify(value ?? []) : value;
  }
  values.manualFields = JSON.stringify([...manual]);

  await db.update(entityBriefings).set(values).where(eq(entityBriefings.id, existing.id));
  const written = await readRow(db, campaignId, targetKind, targetId);
  const briefing = toBriefing(written!);
  await syncIndex(db, briefing);
  return briefing;
}
