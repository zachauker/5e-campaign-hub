import type { StateDb } from "@/lib/state/types";
import { gatherInputs, hashInputs, type BriefingInputs } from "./briefing-inputs";
import { upsertBriefing, type Briefing, type BriefingTargetKind } from "./briefings";
import type { BriefingResult } from "./briefing-agent";

export type GenerateFn = (inputs: BriefingInputs) => Promise<BriefingResult>;
export type FetchNotionBodyFn = (notionUrl: string) => Promise<string | null>;

export interface BuildOptions {
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  generate: GenerateFn;
  fetchNotionBody: FetchNotionBodyFn;
}

/**
 * Build one briefing. Prep-time only.
 *
 * The Notion fetch is allowed to fail: a build that refuses to proceed without
 * the page body would leave the DM with no card at all, which is strictly worse
 * than a card built from local data and labelled `partial`.
 */
export async function buildBriefing(db: StateDb, opts: BuildOptions): Promise<Briefing> {
  const inputs = await gatherInputs(db, opts.campaignId, opts.targetKind, opts.targetId);

  let partial = false;
  if (inputs.notionUrl) {
    try {
      inputs.notionBody = await opts.fetchNotionBody(inputs.notionUrl);
      // A page that exists but returned nothing is not the same as a failure,
      // but the briefing is equally uninformed by it either way.
      if (inputs.notionBody === null) partial = true;
    } catch {
      inputs.notionBody = null;
      partial = true;
    }
  }

  const result = await opts.generate(inputs);

  return upsertBriefing(db, {
    campaignId: opts.campaignId,
    targetKind: opts.targetKind,
    targetId: opts.targetId,
    identity: result.identity,
    wants: result.wants,
    partyKnows: result.partyKnows,
    secret: result.secret,
    voice: result.voice,
    aliases: result.aliases,
    // Hashed without the Notion body so staleness stays answerable from local
    // SQLite. isStale() cannot re-fetch the page without a network round-trip
    // per card, and a hash the checker can never reproduce is always stale.
    sourceHash: hashInputs({ ...inputs, notionBody: null }),
    partial,
  });
}

/**
 * Whether the briefing is behind its inputs. Never blocks a read — the card is
 * still served, with a stale pip. A deleted entity counts as stale rather than
 * an error: the card should say it is behind, not fail to render.
 */
export async function isStale(db: StateDb, briefing: Briefing): Promise<boolean> {
  try {
    const inputs = await gatherInputs(db, briefing.campaignId, briefing.targetKind, briefing.targetId);
    // The Notion body is not re-fetched here — staleness must be answerable
    // from local SQLite alone, or checking it would cost a network round-trip
    // on every card.
    return hashInputs({ ...inputs, notionBody: null }) !== briefing.sourceHash;
  } catch {
    return true;
  }
}
