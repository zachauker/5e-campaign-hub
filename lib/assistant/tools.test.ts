import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { buildTools } from "./tools";

describe("buildTools", () => {
  it("exposes the read + propose tool set bound to a campaign", () => {
    const { db, campaignId } = createTestDb();
    const tools = buildTools(db, campaignId);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_entity", "get_map_context", "get_relationships",
      "list_entities", "list_monsters",
      "propose_encounter", "propose_entity", "propose_marker", "propose_notion_sync",
      "search_entities",
    ]);
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
