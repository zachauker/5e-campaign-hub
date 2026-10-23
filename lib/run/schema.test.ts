import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";

describe("run mode migrations", () => {
  it("creates the three run-mode tables", () => {
    const { db } = createTestDb();
    const rows = db.all<{ name: string }>(sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('entity_briefings', 'run_sessions', 'session_marks')
      ORDER BY name
    `);
    expect(rows.map((r) => r.name)).toEqual(["entity_briefings", "run_sessions", "session_marks"]);
  });

  it("creates the FTS5 search index and accepts a MATCH query", () => {
    const { db, campaignId } = createTestDb();
    db.run(sql`
      INSERT INTO search_index (campaign_id, kind, target_id, name, aliases, body)
      VALUES (${campaignId}, 'character', 'c1', 'Garrick Veldros', 'the mask guy', 'A broker of favours.')
    `);
    const hits = db.all<{ name: string }>(sql`
      SELECT name FROM search_index WHERE search_index MATCH 'garr*'
    `);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Garrick Veldros");
  });

  it("enforces one briefing per target", () => {
    const { db, campaignId } = createTestDb();
    const insert = (id: string) => db.run(sql`
      INSERT INTO entity_briefings (id, campaign_id, target_kind, target_id, source_hash, built_at, created_at, updated_at)
      VALUES (${id}, ${campaignId}, 'character', 'c1', 'h', 1, 1, 1)
    `);
    insert("b1");
    expect(() => insert("b2")).toThrow();
  });
});
