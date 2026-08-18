import type { EntityKind } from "./read-tools";

export interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  /** Verbatim quote from the source the proposal was derived from. Present on review-pass proposals. */
  citation?: string;
}

// Only these fields may be written per entity kind. Notion-synced columns
// (type on locations, description on items, notionProps, etc.) are deliberately absent.
export const HUB_AUTHORED: Record<EntityKind, string[]> = {
  character: ["name", "description", "notionUrl"], // NOT `type`/`ddbCharacterId` — sync-managed via mapCharacterRow extra
  location: ["name", "description", "notionUrl"], // NOT `type` — world-derived, drives map layering
  item: ["name", "notionUrl"],                    // NOT `description` — synced from Notion
  faction: ["name", "description", "notionUrl"],
};

export function assertHubAuthored(kind: EntityKind, fields: Record<string, unknown>): void {
  const allowed = HUB_AUTHORED[kind];
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new Error(`Field not hub-authored: ${key} (kind: ${kind})`);
  }
}

export function buildEncounterProposal(campaignId: string, input: { name: string; notes?: string; combatants?: Array<Record<string, unknown>> }): Proposal {
  const combatants = input.combatants ?? [];
  return {
    summary: `Create encounter "${input.name}" with ${combatants.length} combatant(s).`,
    targetRoute: "/api/encounters",
    method: "POST",
    payload: { campaignId, name: input.name, notes: input.notes ?? null, combatants },
  };
}

export function buildEntityProposal(campaignId: string, input: { kind: EntityKind; id?: string; fields: Record<string, unknown> }): Proposal {
  assertHubAuthored(input.kind, input.fields);
  const base = `/api/${input.kind}s`;
  if (input.id) {
    return { summary: `Update ${input.kind} ${input.id}: ${Object.keys(input.fields).join(", ")}.`, targetRoute: `${base}/${input.id}`, method: "PATCH", payload: { ...input.fields } };
  }
  return { summary: `Create ${input.kind} "${String(input.fields.name ?? "?")}".`, targetRoute: base, method: "POST", payload: { campaignId, ...input.fields } };
}

export function buildMarkerProposal(input: { mapId: string; x: number; y: number; type: string; title?: string; entityId?: string; note?: string }): Proposal {
  const { mapId, ...payload } = input;
  return { summary: `Place a ${input.type} marker${input.title ? ` "${input.title}"` : ""} on map ${mapId}.`, targetRoute: `/api/maps/${mapId}/markers`, method: "POST", payload };
}

export function buildNotionSyncProposal(campaignId: string): Proposal {
  return { summary: "Run a Notion → hub sync for this campaign.", targetRoute: "/api/notion/sync", method: "POST", payload: { campaignId } };
}

const MIN_CITATION_WORDS = 4;

/** Case-, punctuation-, and whitespace-insensitive form used for citation matching. */
export function normalizeForCitation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A review-pass proposal must quote the source verbatim. Paraphrase is rejected:
 * the failure mode we want is "fewer proposals offered", not "plausible wrong
 * state silently applied". Matching is tolerant of case, punctuation, and line
 * wrapping so that a correct quote copied out of Notion still passes.
 */
export function assertCitation(citation: string, sourceText: string): void {
  const normalized = normalizeForCitation(citation ?? "");
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < MIN_CITATION_WORDS) {
    throw new Error(`citation must quote at least ${MIN_CITATION_WORDS} words from the source`);
  }
  if (!normalizeForCitation(sourceText).includes(normalized)) {
    throw new Error("citation not found verbatim in the source text");
  }
}

export interface ThreadLinkProposalInput {
  targetKind: "character" | "location" | "item" | "faction" | "session";
  targetId: string;
  role?: "subject" | "stakeholder" | "obstacle";
}

export function buildThreadOpenProposal(
  campaignId: string,
  input: { title: string; stakes?: string; notes?: string; links?: ThreadLinkProposalInput[]; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Open thread "${input.title}".`,
    targetRoute: "/api/threads",
    method: "POST",
    citation: input.citation,
    payload: {
      campaignId,
      title: input.title,
      stakes: input.stakes ?? null,
      notes: input.notes ?? null,
      links: input.links ?? [],
      sourceKind: "proposal",
    },
  };
}

export function buildThreadResolveProposal(
  input: { threadId: string; threadTitle: string; resolvedSessionId?: string; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Resolve thread "${input.threadTitle}".`,
    targetRoute: `/api/threads/${input.threadId}`,
    method: "PATCH",
    citation: input.citation,
    payload: { status: "resolved", resolvedSessionId: input.resolvedSessionId ?? null },
  };
}

export function buildClockTickProposal(
  input: { clockId: string; clockName: string; delta: number; reason?: string; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${input.delta}`);
  }
  const sign = input.delta > 0 ? `+${input.delta}` : `${input.delta}`;
  return {
    summary: `Tick "${input.clockName}" ${sign}.`,
    targetRoute: `/api/clocks/${input.clockId}/tick`,
    method: "POST",
    citation: input.citation,
    payload: { delta: input.delta, reason: input.reason ?? null, sourceKind: "proposal" },
  };
}

/**
 * Proposes advancing in-world time. The payload is a PREVIEW request (no
 * `apply` key), because which cadence clocks tick is the DM's call, not the
 * model's. The review UI opens the advance dialog seeded with `toDay` rather
 * than POSTing this blind — see the review slide-over.
 */
export function buildDateAdvanceProposal(
  campaignId: string,
  input: { toDay: number; days: number; citation: string },
  sourceText: string,
): Proposal {
  assertCitation(input.citation, sourceText);
  return {
    summary: `Advance in-world time by ${input.days} day(s).`,
    targetRoute: `/api/campaigns/${campaignId}/advance-date`,
    method: "POST",
    citation: input.citation,
    payload: { toDay: input.toDay },
  };
}
