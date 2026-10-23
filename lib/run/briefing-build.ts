import type { StateDb } from "@/lib/state/types";
import { readNoteBody } from "@/lib/vault/note-text";
import { gatherInputs, hashInputs, type BriefingInputs } from "./briefing-inputs";
import { upsertBriefing, type Briefing, type BriefingTargetKind } from "./briefings";
import type { BriefingResult } from "./briefing-agent";

export type GenerateFn = (inputs: BriefingInputs) => Promise<BriefingResult>;

export interface BuildOptions {
  campaignId: string;
  targetKind: BriefingTargetKind;
  targetId: string;
  generate: GenerateFn;
}

/**
 * Build one briefing. Prep-time only.
 *
 * The model is given the note's RAW body from the vault file, `[!dm]` callouts
 * included, not the `source_text` column. `source_text` is stripped of
 * behind-the-screen content so it can be indexed; the briefing's `secret` field
 * is the DM-only counterpart of that and can only be written from the material
 * the stripped text leaves out.
 *
 * A note that cannot be read is allowed to fail: refusing to build would leave
 * the DM with no card at all, which is strictly worse than a card built from
 * the row's own data and labelled `partial`.
 */
export async function buildBriefing(db: StateDb, opts: BuildOptions): Promise<Briefing> {
  const inputs = await gatherInputs(db, opts.campaignId, opts.targetKind, opts.targetId);

  let partial = false;
  if (inputs.sourcePath) {
    try {
      inputs.sourceBody = await readNoteBody(inputs.sourcePath);
      // A note with frontmatter and no prose is readable but tells the model
      // nothing, so the card is equally uninformed by it.
      if (!inputs.sourceBody.trim()) {
        inputs.sourceBody = null;
        partial = true;
      }
    } catch (err) {
      // Logged, not just swallowed. An unmounted vault fails identically on
      // every entity, so without this the DM sees the same "built without the
      // note" badge on every card and cannot tell a systemic misconfiguration
      // from one bad file. Matches the log-and-continue convention in
      // lib/vault/scheduler.ts.
      console.warn(
        `[briefing-build] Could not read the vault note for ${opts.targetKind} ${opts.targetId}:`,
        (err as Error).message,
      );
      inputs.sourceBody = null;
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
    sourceHash: hashInputs(inputs),
    partial,
  });
}

/**
 * Whether the briefing is behind its inputs. Never blocks a read — the card is
 * still served, with a stale pip. A deleted entity counts as stale rather than
 * an error: the card should say it is behind, not fail to render.
 *
 * The note is represented by the `source_hash` column, so this reads only local
 * SQLite; no file is opened and it does not depend on the vault being mounted.
 */
export async function isStale(db: StateDb, briefing: Briefing): Promise<boolean> {
  try {
    const inputs = await gatherInputs(db, briefing.campaignId, briefing.targetKind, briefing.targetId);
    return hashInputs(inputs) !== briefing.sourceHash;
  } catch {
    return true;
  }
}
