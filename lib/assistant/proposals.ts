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
const MAX_ERROR_QUOTE_LEN = 60;

/** IDs interpolated into a route are always crypto.randomUUID() values in practice. */
function assertIdSegment(value: string, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`invalid ${field}: ${JSON.stringify(value)}`);
  }
}

function truncateForError(s: string): string {
  return s.length > MAX_ERROR_QUOTE_LEN ? `${s.slice(0, MAX_ERROR_QUOTE_LEN)}…` : s;
}

/**
 * Lowercases and collapses everything that isn't a-z/0-9 into single spaces
 * (trimmed), while recording, for every character kept in the output, which
 * source-string index it came from. This lets assertCitation map a match in
 * normalized space back to a real slice of the original source text.
 */
function normalizeWithMap(s: string): { normalized: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSeparator = true; // swallow leading separators, matching .trim()
  for (let i = 0; i < s.length; i++) {
    const lower = s[i].toLowerCase();
    if (/[a-z0-9]/.test(lower)) {
      chars.push(lower);
      map.push(i);
      lastWasSeparator = false;
    } else if (!lastWasSeparator) {
      chars.push(" ");
      map.push(i);
      lastWasSeparator = true;
    }
  }
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { normalized: chars.join(""), map };
}

/** Case-, punctuation-, and whitespace-insensitive form used for citation matching. */
export function normalizeForCitation(s: string): string {
  return normalizeWithMap(s).normalized;
}

/**
 * A review-pass proposal must quote the source verbatim. Paraphrase is rejected:
 * the failure mode we want is "fewer proposals offered", not "plausible wrong
 * state silently applied". Matching is tolerant of case, punctuation, and line
 * wrapping so that a correct quote copied out of Notion still passes.
 *
 * Only tokens containing at least two letters count toward the word minimum —
 * bare ids, timestamps, and numbers can't satisfy the gate on their own.
 *
 * Returns the matched slice of `sourceText` itself (not the input citation),
 * so what gets stored and shown to the DM is provably real source text —
 * a model can't glue unrelated bullets together or flip a `?` to a `.` by
 * choosing how it phrases the citation string.
 */
export function assertCitation(citation: string, sourceText: string): string {
  if (typeof sourceText !== "string") {
    throw new Error("assertCitation: sourceText must be a string");
  }
  const rawCitation = typeof citation === "string" ? citation : "";
  const normalizedCitation = normalizeForCitation(rawCitation);
  const words = normalizedCitation.split(" ").filter((w) => /[a-z]{2}/.test(w));
  if (words.length < MIN_CITATION_WORDS) {
    throw new Error(
      `citation must quote at least ${MIN_CITATION_WORDS} words from the source (got: "${truncateForError(rawCitation)}"). ` +
        `Quote a longer verbatim phrase — ids, timestamps, and bare numbers don't count.`,
    );
  }
  const { normalized: normalizedSource, map } = normalizeWithMap(sourceText);
  const start = normalizedSource.indexOf(normalizedCitation);
  if (start === -1) {
    throw new Error(
      `citation not found verbatim in the source text (got: "${truncateForError(rawCitation)}"). ` +
        `Quote an exact phrase from the source instead of paraphrasing — matching already ignores case, punctuation, and line breaks.`,
    );
  }
  const end = start + normalizedCitation.length - 1;
  return sourceText.slice(map[start], map[end] + 1);
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
  const citation = assertCitation(input.citation, sourceText);
  return {
    summary: `Open thread "${input.title}".`,
    targetRoute: "/api/threads",
    method: "POST",
    citation,
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
  assertIdSegment(input.threadId, "threadId");
  const citation = assertCitation(input.citation, sourceText);
  return {
    summary: `Resolve thread "${input.threadTitle}".`,
    targetRoute: `/api/threads/${input.threadId}`,
    method: "PATCH",
    citation,
    payload: {
      status: "resolved",
      resolvedSessionId: input.resolvedSessionId ?? null,
      sourceKind: "proposal",
    },
  };
}

export function buildClockTickProposal(
  input: { clockId: string; clockName: string; delta: number; reason?: string; citation: string },
  sourceText: string,
): Proposal {
  assertIdSegment(input.clockId, "clockId");
  const citation = assertCitation(input.citation, sourceText);
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${input.delta}`);
  }
  const sign = input.delta > 0 ? `+${input.delta}` : `${input.delta}`;
  return {
    summary: `Tick "${input.clockName}" ${sign}.`,
    targetRoute: `/api/clocks/${input.clockId}/tick`,
    method: "POST",
    citation,
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
  assertIdSegment(campaignId, "campaignId");
  const citation = assertCitation(input.citation, sourceText);
  return {
    summary: `Advance in-world time by ${input.days} day(s).`,
    targetRoute: `/api/campaigns/${campaignId}/advance-date`,
    method: "POST",
    citation,
    payload: { toDay: input.toDay },
  };
}
