import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { runMigrations } from "@/lib/db/migrate";

const MIRRORED_TABLES = ["characters", "locations", "items", "factions", "session_notes"];

function columnNames(db: TestDb, table: string): string[] {
  const rows = db.$client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Insert a row carrying only the NOT NULL columns plus the given source ids. */
function insertRow(
  db: TestDb,
  table: string,
  campaignId: string,
  ids: { notionPageId: string | null; sourceKey: string | null },
): string {
  const id = crypto.randomUUID();
  const extra = table === "characters" ? { col: ", type", val: ", 'npc'" } : { col: "", val: "" };
  db.$client
    .prepare(
      `INSERT INTO ${table} (id, campaign_id, name${extra.col}, notion_page_id, source_key, created_at, updated_at)
       VALUES (?, ?, 'Row'${extra.val}, ?, ?, 0, 0)`,
    )
    .run(id, campaignId, ids.notionPageId, ids.sourceKey);
  return id;
}

function sourceKeyOf(db: TestDb, table: string, id: string): string | null {
  const row = db.$client.prepare(`SELECT source_key FROM ${table} WHERE id = ?`).get(id) as {
    source_key: string | null;
  };
  return row.source_key;
}

describe("vault schema", () => {
  it("adds the six source columns to every mirrored table", () => {
    const { db } = createTestDb();
    for (const table of MIRRORED_TABLES) {
      expect(columnNames(db, table)).toEqual(
        expect.arrayContaining([
          "source_key",
          "source_path",
          "source_props",
          "source_synced_at",
          "source_hash",
          "source_text",
        ]),
      );
    }
  });

  it("adds parent_location_id to locations only", () => {
    const { db } = createTestDb();
    expect(columnNames(db, "locations")).toContain("parent_location_id");
    for (const table of MIRRORED_TABLES.filter((t) => t !== "locations")) {
      expect(columnNames(db, table)).not.toContain("parent_location_id");
    }
  });

  it("keeps the notion columns in place", () => {
    const { db } = createTestDb();
    for (const table of MIRRORED_TABLES) {
      expect(columnNames(db, table)).toEqual(
        expect.arrayContaining(["notion_page_id", "notion_props", "notion_synced_at"]),
      );
    }
    expect(columnNames(db, "notion_sources")).toContain("database_url");
  });

  it("creates vault_sources keyed by campaign alone", () => {
    const { db } = createTestDb();
    expect(columnNames(db, "vault_sources")).toEqual(
      expect.arrayContaining(["campaign_id", "root_path", "last_synced_at", "last_status"]),
    );
    const pk = (
      db.$client.prepare("PRAGMA table_info(vault_sources)").all() as Array<{
        name: string;
        pk: number;
      }>
    )
      .filter((c) => c.pk > 0)
      .map((c) => c.name);
    expect(pk).toEqual(["campaign_id"]);
  });

  it("backfills source_key from notion_page_id", () => {
    const { db, campaignId } = createTestDb();
    const ids = MIRRORED_TABLES.map((table) => ({
      table,
      id: insertRow(db, table, campaignId, { notionPageId: `notion-${table}`, sourceKey: null }),
    }));

    runMigrations();

    for (const { table, id } of ids) {
      expect(sourceKeyOf(db, table, id)).toBe(`notion-${table}`);
    }
  });

  it("leaves an existing source_key alone when backfilling", () => {
    const { db, campaignId } = createTestDb();
    const withBoth = insertRow(db, "characters", campaignId, {
      notionPageId: "notion-page",
      sourceKey: "vault-key",
    });
    const withNeither = insertRow(db, "characters", campaignId, {
      notionPageId: null,
      sourceKey: null,
    });

    runMigrations();
    runMigrations(); // idempotent: a second boot changes nothing

    expect(sourceKeyOf(db, "characters", withBoth)).toBe("vault-key");
    expect(sourceKeyOf(db, "characters", withNeither)).toBeNull();
  });
});
