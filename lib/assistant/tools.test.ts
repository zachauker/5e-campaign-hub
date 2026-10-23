import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db/test-helpers";
import { buildTools } from "./tools";

describe("buildTools", () => {
  it("exposes the read + propose tool set bound to a campaign", () => {
    const { db, campaignId } = createTestDb();
    const tools = buildTools(db, campaignId);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_entity", "get_map_context", "get_relationships",
      "list_clocks", "list_entities", "list_monsters", "list_open_threads",
      "propose_encounter", "propose_entity", "propose_marker", "propose_notion_sync",
      "search_entities", "search_reference",
    ]);
  });

  it("list_open_threads returns the campaign's open threads", async () => {
    const { db, campaignId } = createTestDb();
    const { createThread } = await import("@/lib/state/threads");
    await createThread(db, { campaignId, title: "Find Ovid", currentDay: 100 });

    const tool = buildTools(db, campaignId).find((t) => t.name === "list_open_threads")!;
    const run = tool.run as (input: Record<string, never>) => Promise<string>;
    expect(JSON.parse(await run({}))[0]).toMatchObject({ title: "Find Ovid" });
  });

  it("propose_notion_sync returns a proposal object, does not mutate", async () => {
    const { db, campaignId } = createTestDb();
    const tools = buildTools(db, campaignId);
    const tool = tools.find((t) => t.name === "propose_notion_sync")!;
    // `tools` is a union of tool types, so `.run`'s param narrows to the intersection
    // of all input schemas; cast to call propose_notion_sync (empty input) directly.
    const run = tool.run as (input: Record<string, never>) => Promise<string>;
    const result = await run({});
    expect(JSON.parse(result as string)).toMatchObject({ proposal: { targetRoute: "/api/notion/sync" } });
  });
});
