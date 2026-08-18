import Anthropic from "@anthropic-ai/sdk";
import { buildReviewTools, type ReviewToolsContext } from "./review-tools";

export interface ReviewEvent {
  type: "text" | "proposal" | "summary" | "done" | "error";
  text?: string;
  proposal?: unknown;
  /** On "summary": how many proposals survived and how many were rejected for a bad citation. */
  proposalCount?: number;
  rejectedCount?: number;
  message?: string;
}

export const REVIEW_SYSTEM = `You are reviewing a Dungeon Master's notes from a session that has already been played, to propose updates to the campaign's tracked state.

First call list_open_threads and list_clocks so you know what already exists — never propose opening a thread that duplicates an open one, and never propose ticking a clock you have not read.

Then propose only what the notes actually support:
- propose_thread_resolve for an open thread the session answered.
- propose_thread_open for a genuinely new unresolved question the session raised. Use search_entities to link it to the characters, locations, and factions involved.
- propose_clock_tick when the session advanced a faction's or location's ongoing effort.
- propose_date_advance if the notes state that in-world time passed.

Every proposal requires a \`citation\`: a passage COPIED VERBATIM from the session notes. Do not paraphrase, summarize, or reconstruct it from memory — a citation that is not literally present in the notes is rejected and the proposal is discarded. If you cannot quote it, do not propose it.

Nothing you propose is applied. The DM confirms each proposal in the UI. Never say you have changed anything.

Finish with one short paragraph naming what you proposed. Be sparing: three well-grounded proposals beat ten speculative ones.`;

/**
 * Pull a proposal (or a rejection) out of one tool result. Exported for testing;
 * `runSessionReview` wires it into each tool's `run`.
 */
export function captureFromToolResult(
  result: unknown,
  proposalSink: unknown[],
  counts: { rejected: number },
): void {
  if (typeof result !== "string") return;
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== "object") return;
    if ("proposal" in parsed && parsed.proposal != null) proposalSink.push(parsed.proposal);
    else if ("rejected" in parsed && parsed.rejected === true) counts.rejected++;
  } catch {
    // Not JSON — nothing to capture.
  }
}

export async function runSessionReview(
  opts: { apiKey: string } & ReviewToolsContext,
  onEvent: (e: ReviewEvent) => void,
): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const proposals: unknown[] = [];
  const counts = { rejected: 0 };

  const tools = buildReviewTools(opts).map((tool) => {
    const originalRun = tool.run as (args: unknown, context?: unknown) => unknown;
    const run = async (args: unknown, context?: unknown) => {
      const result = await originalRun(args, context);
      captureFromToolResult(result, proposals, counts);
      return result;
    };
    return { ...tool, run } as typeof tool;
  });

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    max_iterations: 16,
    output_config: { effort: "high" },
    system: REVIEW_SYSTEM,
    tools,
    messages: [
      {
        role: "user",
        content: `Review these session notes and propose state updates.\n\n<session_notes>\n${opts.sourceText}\n</session_notes>`,
      },
    ],
    stream: true,
  });

  let emittedText = false;
  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        emittedText = true;
        onEvent({ type: "text", text: event.delta.text });
      }
    }
    await messageStream.finalMessage();
  }

  if (!emittedText) {
    onEvent({ type: "text", text: "No review output was produced — try again." });
  }

  for (const proposal of proposals) onEvent({ type: "proposal", proposal });

  onEvent({ type: "summary", proposalCount: proposals.length, rejectedCount: counts.rejected });
  onEvent({ type: "done" });
}
