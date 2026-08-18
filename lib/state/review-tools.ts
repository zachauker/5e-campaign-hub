import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { searchEntities } from "@/lib/assistant/read-tools";
import {
  buildThreadOpenProposal,
  buildThreadResolveProposal,
  buildClockTickProposal,
  buildDateAdvanceProposal,
} from "@/lib/assistant/proposals";
import { listThreads } from "./threads";
import { listClocks } from "./clocks";
import type { StateDb } from "./types";

const j = (v: unknown) => JSON.stringify(v);

/** A rejected proposal is data, not an exception — the model gets a chance to re-quote. */
const rejected = (err: unknown) => j({ rejected: true, error: (err as Error).message });

const linkSchema = z.object({
  targetKind: z.enum(["character", "location", "item", "faction", "session"]),
  targetId: z.string(),
  role: z.enum(["subject", "stakeholder", "obstacle"]).optional(),
});

export interface ReviewToolsContext {
  db: StateDb;
  campaignId: string;
  /** Flattened session-note text. Every citation is checked against this. */
  sourceText: string;
  sessionNoteId: string;
  currentDay: number | null;
}

export function buildReviewTools(ctx: ReviewToolsContext) {
  const { db, campaignId, sourceText, sessionNoteId, currentDay } = ctx;

  return [
    betaZodTool({
      name: "list_open_threads",
      description: "List the campaign's currently open plot threads with their ids, stakes, and staleness. Call this first — you need thread ids before you can propose resolving one.",
      inputSchema: z.object({}),
      run: async () => j(await listThreads(db, campaignId, { currentDay })),
    }),
    betaZodTool({
      name: "list_clocks",
      description: "List the campaign's clocks with id, name, filled/segments, owner, and status. Call before proposing a tick — you need the clock id.",
      inputSchema: z.object({}),
      run: async () => j(await listClocks(db, campaignId)),
    }),
    betaZodTool({
      name: "search_entities",
      description: "Search characters, locations, items, and factions by name to resolve a name in the session notes to an entity id, for linking a thread.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(searchEntities(db, campaignId, { query })),
    }),

    betaZodTool({
      name: "propose_thread_open",
      description: "Propose opening a new plot thread that this session raised. Does NOT create it. `citation` MUST be copied verbatim from the session notes — paraphrase is rejected. If the citation cannot be matched this returns `{rejected: true, error}` — fix the quote from the notes and call again; nothing is written either way. Call list_open_threads first — if the session advances an existing thread rather than raising a new one, do not open a duplicate.",
      inputSchema: z.object({
        title: z.string(),
        stakes: z.string().optional(),
        links: z.array(linkSchema).optional(),
        citation: z.string(),
      }),
      run: async (input) => {
        try {
          return j({ proposal: buildThreadOpenProposal(campaignId, { ...input, links: input.links ?? [] }, sourceText) });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_thread_resolve",
      description: "Propose marking an existing thread resolved because this session answered it. Get the id from list_open_threads. `citation` MUST be verbatim from the session notes. If the citation cannot be matched this returns `{rejected: true, error}` — fix the quote from the notes and call again; nothing is written either way.",
      inputSchema: z.object({ threadId: z.string(), citation: z.string() }),
      run: async ({ threadId, citation }) => {
        try {
          const open = await listThreads(db, campaignId, { currentDay });
          const thread = open.find((t) => t.id === threadId);
          if (!thread) {
            throw new Error(
              `unknown thread id: ${threadId} — it is not in the open list. It may already be resolved or archived. Call list_open_threads and use an id from that result.`,
            );
          }
          return j({
            proposal: buildThreadResolveProposal(
              { threadId, threadTitle: thread.title, resolvedSessionId: sessionNoteId, citation },
              sourceText,
            ),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_clock_tick",
      description: "Propose moving a clock by a delta (never an absolute value) because of what happened this session. `delta` must be a non-zero integer — 0 is always rejected. Get the id from list_clocks. `citation` MUST be verbatim from the session notes. If the citation cannot be matched this returns `{rejected: true, error}` — fix the quote from the notes and call again; nothing is written either way.",
      inputSchema: z.object({
        clockId: z.string(),
        delta: z.number().int(),
        reason: z.string().optional(),
        citation: z.string(),
      }),
      run: async ({ clockId, delta, reason, citation }) => {
        try {
          const all = await listClocks(db, campaignId);
          const clock = all.find((c) => c.id === clockId);
          if (!clock) {
            throw new Error(
              `unknown clock id: ${clockId} — it is not in the clock list. It may already be archived. Call list_clocks and use an id from that result.`,
            );
          }
          return j({
            proposal: buildClockTickProposal(
              { clockId, clockName: clock.name, delta, reason, citation },
              sourceText,
            ),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
    betaZodTool({
      name: "propose_date_advance",
      description: "Propose advancing in-world time by a number of days that passed during this session. `citation` MUST be verbatim from the session notes. Which clocks tick is the DM's call, not yours. If the citation cannot be matched this returns `{rejected: true, error}` — fix the quote from the notes and call again; nothing is written either way.",
      inputSchema: z.object({ days: z.number().int(), citation: z.string() }),
      run: async ({ days, citation }) => {
        try {
          if (currentDay === null) {
            throw new Error(
              "the campaign has no in-world date set yet. Only the DM can set a starting date — do not retry this call. Mention in your summary that a date needs to be set.",
            );
          }
          if (!Number.isInteger(days) || days <= 0) throw new Error(`days must be a positive integer, got ${days}`);
          return j({
            proposal: buildDateAdvanceProposal(campaignId, { toDay: currentDay + days, days, citation }, sourceText),
          });
        } catch (err) {
          return rejected(err);
        }
      },
    }),
  ];
}
