import Anthropic from "@anthropic-ai/sdk";
import type { AppDb } from "./read-tools";
import { buildTools } from "./tools";

export interface AssistantEvent {
  type: "text" | "proposal" | "done" | "error";
  text?: string;
  proposal?: unknown;
  message?: string;
}

const SYSTEM = `You are the Dungeon Master's assistant for a D&D campaign hub.
Answer questions about the campaign by calling the read tools; resolve names with search_entities before answering.
To take an action (build an encounter, create/edit an entity, place a marker, run a Notion sync), call the matching propose_* tool. Proposals are NOT applied until the DM confirms in the UI — after proposing, briefly tell the DM what you proposed and that it needs confirmation. Never claim you have created or changed anything yourself.
Be concise and grounded: only state facts you retrieved via tools.
For any D&D rules/mechanics question or published-setting lore question, call search_reference and cite the sourceRef of the passages you used. If search_reference returns nothing relevant, say you have no indexed source for it rather than inventing a citation or answering rules from memory.`;

type AgentTool = ReturnType<typeof buildTools>[number];

/**
 * Wrap every tool's `run` so that, in addition to returning its normal result to
 * the model, any `{proposal}` it produces is also pushed into `sink`.
 *
 * Why this exists instead of reading proposals back off the accumulated
 * transcript: `BetaToolRunner` (client.beta.messages.toolRunner) has no public
 * `.messages` accessor — the real accessor for the accumulated conversation is
 * the `runner.params.messages` getter (`BetaToolRunner#params`), which returns
 * the internal, continuously-mutated params object including every appended
 * assistant/tool-result turn. Scanning that after the loop would work, but it
 * couples this file to the exact shape `tools.ts` uses for tool_result content
 * (currently a raw JSON string, not a content-block array) and to a
 * ToolRunner internal that isn't part of its documented public surface.
 * Decorating the tools' `run` functions here is simpler, doesn't require
 * touching tools.ts, and captures a proposal the moment it's produced instead
 * of re-deriving it from serialized tool output.
 */
function withProposalCapture(tools: AgentTool[], sink: unknown[]): AgentTool[] {
  return tools.map((tool) => {
    const originalRun = tool.run as (args: unknown, context?: unknown) => unknown;
    const run = async (args: unknown, context?: unknown) => {
      const result = await originalRun(args, context);
      if (typeof result === "string") {
        try {
          const parsed = JSON.parse(result);
          if (parsed && typeof parsed === "object" && "proposal" in parsed && parsed.proposal != null) {
            sink.push(parsed.proposal);
          }
        } catch {
          // Not JSON (or not a proposal-shaped tool result) — nothing to capture.
        }
      }
      return result;
    };
    return { ...tool, run } as AgentTool;
  });
}

export async function runAssistant(
  opts: { apiKey: string; db: AppDb; campaignId: string; messages: Anthropic.Beta.BetaMessageParam[] },
  onEvent: (e: AssistantEvent) => void,
): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const proposals: unknown[] = [];
  const tools = withProposalCapture(buildTools(opts.db, opts.campaignId), proposals);

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    max_iterations: 12,
    output_config: { effort: "high" },
    system: SYSTEM,
    tools,
    messages: opts.messages,
    stream: true,
  });

  let lastMessage: Anthropic.Beta.BetaMessage | undefined;
  let emittedText = false;
  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        emittedText = true;
        onEvent({ type: "text", text: event.delta.text });
      }
    }
    lastMessage = await messageStream.finalMessage();
  }

  if (lastMessage?.stop_reason === "refusal") {
    onEvent({ type: "text", text: "I can't help with that." });
  } else if (!emittedText) {
    onEvent({ type: "text", text: "I wasn't able to produce an answer — try rephrasing." });
  }

  for (const proposal of proposals) {
    onEvent({ type: "proposal", proposal });
  }

  onEvent({ type: "done" });
}
