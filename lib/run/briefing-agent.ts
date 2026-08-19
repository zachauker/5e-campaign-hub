import Anthropic from "@anthropic-ai/sdk";
import type { BriefingInputs } from "./briefing-inputs";

/** Structured-output schema. `additionalProperties: false` and a full `required` list are mandatory. */
export const BRIEFING_SCHEMA = {
  type: "object",
  properties: {
    identity: { type: ["string", "null"], description: "One line: who or what this is." },
    wants: { type: ["string", "null"], description: "What they are currently after. Null if the notes do not say." },
    partyKnows: { type: ["string", "null"], description: "What the party has actually learned, as distinct from what the DM knows." },
    secret: { type: ["string", "null"], description: "DM-only. Something true the party has not learned." },
    voice: { type: ["string", "null"], description: "One line of speech and manner. Characters only; null otherwise." },
    aliases: {
      type: "array",
      items: { type: "string" },
      description: "Nicknames, titles, and how the party refers to them. Empty array if none.",
    },
  },
  required: ["identity", "wants", "partyKnows", "secret", "voice", "aliases"],
  additionalProperties: false,
} as const;

export const BRIEFING_SYSTEM = `You are writing a Dungeon Master's at-table briefing card for one campaign entity.

The DM reads this mid-scene with players waiting, so every field is one or two sentences at most. No preamble, no headings, no restating the name.

Write only what the supplied notes support. If the notes do not establish a field, return null for it — an invented motive is worse than a missing one, because the DM will say it out loud and it becomes canon.

"partyKnows" is what the player characters have actually learned. "secret" is something true that they have not. Keeping them apart is the point of the card; do not put a secret in partyKnows.

"voice" is how to sound like this person again three sessions later — speech rhythm, register, verbal habits. Not backstory. Leave it null for anything that is not a person.

"aliases" are the names the DM might actually type when searching: nicknames, titles, and how the party refers to them in play.`;

export interface BriefingResult {
  identity: string | null;
  wants: string | null;
  partyKnows: string | null;
  secret: string | null;
  voice: string | null;
  aliases: string[];
}

export function buildPrompt(inputs: BriefingInputs): string {
  const lines: string[] = [
    `Entity kind: ${inputs.targetKind}`,
    `Name: ${inputs.name}`,
    "",
    "Description:",
    inputs.description?.trim() || "(none recorded)",
    "",
    "Notion properties:",
    inputs.notionProps?.trim() || "(none recorded)",
    "",
    "Notion page body:",
    inputs.notionBody?.trim() || "(the page body was not available for this build)",
    "",
    "Linked open threads:",
    inputs.threads.length
      ? inputs.threads
          .map((t) => `- [${t.role}, ${t.status}] ${t.title}${t.stakes ? ` — stakes: ${t.stakes}` : ""}`)
          .join("\n")
      : "(none)",
    "",
    "Recent timeline events mentioning them:",
    inputs.timeline.length
      ? inputs.timeline.map((e) => `- day ${e.day} [${e.kind}] ${e.title}${e.body ? `: ${e.body}` : ""}`).join("\n")
      : "(none)",
    "",
  ];
  lines.push(
    inputs.targetKind === "character"
      ? 'Write the card. Include a "voice" line.'
      : 'Write the card. "voice": leave null — this is not a person.',
  );
  return lines.join("\n");
}

interface RawResponse {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}

/**
 * Pull the briefing object out of a response. Exported separately from the API
 * call so the parsing rules are testable without a network round-trip.
 */
export function parseBriefingResponse(response: RawResponse): BriefingResult {
  // Checked before reading content: on a refusal the content array is empty or
  // partial, and indexing into it would throw something unhelpful.
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to write this briefing.");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("The model returned no text to read.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not read the model's response as JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Could not read the model's response as a briefing.");
  }

  const obj = parsed as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    identity: str(obj.identity),
    wants: str(obj.wants),
    partyKnows: str(obj.partyKnows),
    secret: str(obj.secret),
    voice: str(obj.voice),
    aliases: Array.isArray(obj.aliases)
      ? obj.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      : [],
  };
}

/**
 * One call per entity. Runs at prep time only — nothing on the /run path ever
 * reaches this function.
 */
export async function generateBriefing(
  inputs: BriefingInputs,
  opts: { apiKey: string },
): Promise<BriefingResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: BRIEFING_SYSTEM,
    output_config: {
      // Summarising notes into six short fields does not need deep reasoning,
      // and a campaign-wide build is hundreds of these calls.
      effort: "medium",
      format: { type: "json_schema", schema: BRIEFING_SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(inputs) }],
  });
  return parseBriefingResponse(response as unknown as RawResponse);
}
