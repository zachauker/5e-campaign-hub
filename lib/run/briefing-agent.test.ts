import { describe, it, expect } from "vitest";
import { BRIEFING_SCHEMA, BRIEFING_SYSTEM, buildPrompt, parseBriefingResponse } from "./briefing-agent";
import type { BriefingInputs } from "./briefing-inputs";

const inputs: BriefingInputs = {
  targetKind: "character",
  targetId: "c1",
  name: "Garrick Veldros",
  description: "A broker of favours.",
  notionProps: '{"Role":"Fixer"}',
  notionUrl: null,
  threads: [{ title: "Who forged the writ?", stakes: "The party stays hunted.", status: "open", role: "subject" }],
  timeline: [{ day: 100, kind: "thread_opened", title: "Writ questioned", body: "The seal was wrong." }],
  notionBody: "Garrick keeps a mask on his belt at all times.",
};

describe("BRIEFING_SCHEMA", () => {
  it("forbids extra properties and requires every field", () => {
    expect(BRIEFING_SCHEMA.additionalProperties).toBe(false);
    expect([...BRIEFING_SCHEMA.required].sort()).toEqual(
      ["aliases", "identity", "partyKnows", "secret", "voice", "wants"],
    );
  });
});

describe("buildPrompt", () => {
  it("includes the name, description, threads, timeline, and Notion body", () => {
    const prompt = buildPrompt(inputs);
    expect(prompt).toContain("Garrick Veldros");
    expect(prompt).toContain("A broker of favours.");
    expect(prompt).toContain("Who forged the writ?");
    expect(prompt).toContain("Writ questioned");
    expect(prompt).toContain("mask on his belt");
  });

  it("says the page body was unavailable when it is null", () => {
    const prompt = buildPrompt({ ...inputs, notionBody: null });
    expect(prompt).toMatch(/page body (was )?not available/i);
  });

  it("only asks for a voice line on characters", () => {
    expect(buildPrompt(inputs)).toContain("voice");
    expect(buildPrompt({ ...inputs, targetKind: "location" })).toContain('"voice": leave null');
  });
});

describe("parseBriefingResponse", () => {
  it("reads the JSON out of the text block", () => {
    const result = parseBriefingResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({
        identity: "A broker of favours in Druvenlode.",
        wants: "Leverage over the Assembly.",
        partyKnows: "That he sold them a forged writ.",
        secret: "He informs for the Assembly.",
        voice: "Clipped, over-formal.",
        aliases: ["the mask guy"],
      }) }],
    });
    expect(result.identity).toBe("A broker of favours in Druvenlode.");
    expect(result.aliases).toEqual(["the mask guy"]);
  });

  it("coerces a missing or non-array aliases field to an empty array", () => {
    const result = parseBriefingResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ identity: "A broker.", aliases: "the mask guy" }) }],
    });
    expect(result.aliases).toEqual([]);
    expect(result.wants).toBeNull();
  });

  it("throws on a refusal rather than reading content", () => {
    expect(() => parseBriefingResponse({ stop_reason: "refusal", content: [] })).toThrow(/declined/i);
  });

  it("throws when there is no text block", () => {
    expect(() => parseBriefingResponse({ stop_reason: "end_turn", content: [] })).toThrow(/no text/i);
  });

  it("throws on unparseable JSON", () => {
    expect(() =>
      parseBriefingResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
    ).toThrow(/could not read/i);
  });
});

describe("BRIEFING_SYSTEM", () => {
  it("tells the model not to invent facts", () => {
    expect(BRIEFING_SYSTEM).toMatch(/null/);
    expect(BRIEFING_SYSTEM.length).toBeGreaterThan(100);
  });
});
