import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db/test-helpers";
import { buildReviewTools } from "./review-tools";
import { createThread } from "./threads";
import { createClock } from "./clocks";
import { setDate } from "./advance";

const NOTES = `The party cornered Ovid in the Pentamarket. He admitted the contract came
through a broker in Zadash, but died before naming them. Nine days pass on the road east.`;

async function ctx() {
  const { db, campaignId } = createTestDb();
  await setDate(db, campaignId, 276_000, "P.D.");
  const tools = buildReviewTools({ db, campaignId, sourceText: NOTES, sessionNoteId: "s1", currentDay: 276_000 });
  // NOTE: this calls `tool.run` directly, skipping the zod `parse` step the
  // SDK's tool runner performs in production (parse(input) then run(input)).
  // Unknown-key stripping and schema coercion are therefore untested here —
  // this harness only exercises `run`'s own logic, not input validation.
  const call = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    const run = tool.run as (i: unknown) => Promise<string>;
    return JSON.parse(await run(input));
  };
  return { db, campaignId, tools, call };
}

async function ctxNoDate() {
  const { db, campaignId } = createTestDb();
  const tools = buildReviewTools({ db, campaignId, sourceText: NOTES, sessionNoteId: "s1", currentDay: null });
  const call = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    const run = tool.run as (i: unknown) => Promise<string>;
    return JSON.parse(await run(input));
  };
  return { db, campaignId, tools, call };
}

describe("buildReviewTools", () => {
  it("exposes the read + propose set", async () => {
    const { tools } = await ctx();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "list_clocks", "list_open_threads", "propose_clock_tick", "propose_date_advance",
      "propose_thread_open", "propose_thread_resolve", "search_entities",
    ]);
  });

  it("list_open_threads returns open threads with ids", async () => {
    const { db, campaignId, call } = await ctx();
    await createThread(db, { campaignId, title: "Find Ovid", currentDay: 275_990 });
    const out = await call("list_open_threads", {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Find Ovid", status: "open" });
    expect(out[0].id).toBeTruthy();
  });

  it("list_clocks returns clocks with filled/segments", async () => {
    const { db, campaignId, call } = await ctx();
    await createClock(db, { campaignId, name: "Assembly", segments: 8, cadenceDays: 7, currentDay: 276_000 });
    const out = await call("list_clocks", {});
    expect(out[0]).toMatchObject({ name: "Assembly", filled: 0, segments: 8 });
  });

  it("propose_thread_open returns a proposal without mutating", async () => {
    const { db, campaignId, call } = await ctx();
    const out = await call("propose_thread_open", {
      title: "Who is the Zadash broker?",
      stakes: "The contract holder still hunts them.",
      citation: "the contract came through a broker in Zadash",
      links: [],
    });
    expect(out.proposal).toMatchObject({ targetRoute: "/api/threads", method: "POST" });
    const { listThreads } = await import("./threads");
    expect(await listThreads(db, campaignId, { currentDay: 276_000 })).toHaveLength(0);
  });

  it("rejects an uncited proposal instead of throwing", async () => {
    const { call } = await ctx();
    // "a sentence never written" would look like 4 words, but assertCitation's word-count
    // gate only counts tokens with 2+ letters — "a" doesn't qualify, so that string trips
    // the "at least 4 words" error rather than exercising the not-found path this test is
    // for. Padded to 5 qualifying words so it clears the word-count gate and hits "not found".
    const out = await call("propose_thread_open", { title: "T", citation: "this sentence was never written", links: [] });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/not found/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_clock_tick carries a delta", async () => {
    const { db, campaignId, call } = await ctx();
    const c = await createClock(db, { campaignId, name: "Assembly", currentDay: 276_000 });
    const out = await call("propose_clock_tick", {
      clockId: c.id, delta: 1, reason: "attention drawn",
      citation: "He admitted the contract came through a broker",
    });
    expect(out.proposal.payload).toMatchObject({ delta: 1, sourceKind: "proposal" });
  });

  it("propose_clock_tick rejects an unknown clock id", async () => {
    const { call } = await ctx();
    const out = await call("propose_clock_tick", {
      clockId: "nope", delta: 1, citation: "the contract came through a broker in Zadash",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/unknown clock/i);
  });

  it("propose_thread_resolve rejects an unknown thread id", async () => {
    const { call } = await ctx();
    const out = await call("propose_thread_resolve", {
      threadId: "nope", citation: "The party cornered Ovid in the Pentamarket",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/unknown thread/i);
  });

  // Mutation-testing gap: the tools above only ever exercised assertCitation
  // with a VALID citation. A reviewer found that swapping the model-controlled
  // `citation` in for the server-fetched `sourceText` argument (so the gate
  // validates the model's own quote against itself) passed the whole suite for
  // propose_thread_resolve, propose_clock_tick, and propose_date_advance — only
  // propose_thread_open had a bad-citation case to catch it. These four tests
  // close that gap: each uses a valid, EXISTING id so the id lookup succeeds
  // and the call actually reaches assertCitation with an ungrounded quote.

  it("propose_thread_resolve rejects an ungrounded citation for a real thread", async () => {
    const { db, campaignId, call } = await ctx();
    const t = await createThread(db, { campaignId, title: "Find Ovid", currentDay: 275_990 });
    const out = await call("propose_thread_resolve", {
      threadId: t.id, citation: "this sentence was never written in the notes",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/not found/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_clock_tick rejects an ungrounded citation for a real clock", async () => {
    const { db, campaignId, call } = await ctx();
    const c = await createClock(db, { campaignId, name: "Assembly", currentDay: 276_000 });
    const out = await call("propose_clock_tick", {
      clockId: c.id, delta: 1, citation: "this sentence was never written in the notes",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/not found/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_date_advance rejects an ungrounded citation", async () => {
    const { call } = await ctx();
    const out = await call("propose_date_advance", {
      days: 9, citation: "this sentence was never written in the notes",
    });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/not found/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_date_advance rejects when the campaign has no in-world date set", async () => {
    const { call } = await ctxNoDate();
    const out = await call("propose_date_advance", { days: 9, citation: "Nine days pass on the road east" });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/no in-world date/i);
    expect(out.proposal).toBeUndefined();
  });

  it("propose_date_advance converts elapsed days into an absolute toDay", async () => {
    const { call } = await ctx();
    const out = await call("propose_date_advance", { days: 9, citation: "Nine days pass on the road east" });
    expect(out.proposal.payload).toEqual({ toDay: 276_009 });
  });

  it("propose_date_advance rejects a non-positive span", async () => {
    const { call } = await ctx();
    const out = await call("propose_date_advance", { days: 0, citation: "Nine days pass on the road east" });
    expect(out.rejected).toBe(true);
    expect(out.error).toMatch(/days/i);
  });
});
