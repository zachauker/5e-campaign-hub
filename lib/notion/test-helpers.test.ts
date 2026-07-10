import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-helpers";
import { campaigns } from "@/lib/db/schema";

describe("createTestDb", () => {
  it("creates a migrated db with a campaign", async () => {
    const { db, campaignId } = createTestDb();
    const rows = await db.select().from(campaigns);
    expect(rows.find((c) => c.id === campaignId)).toBeTruthy();
  });
});
