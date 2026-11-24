import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/db/test-helpers";
import { saveEncounter } from "./save";
import type { CombatantWithParsed } from "@/lib/types";

function seedEncounter(db: TestDb, campaignId: string) {
  db.run(sql`INSERT INTO encounters (id, campaign_id, name, status, round, created_at, updated_at)
    VALUES ('enc1', ${campaignId}, 'Ambush on the Ashkeeper Road', 'idle', 1, 1, 1)`);
  db.run(sql`INSERT INTO combatants
      (id, encounter_id, name, type, initiative, initiative_bonus, hp_current, hp_max, hp_temp, ac, speed, conditions, is_concentrating, is_visible, sort_order)
    VALUES ('c-existing', 'enc1', 'Garrick Veldros', 'pc', 18, 3, 40, 40, 0, 16, 30, '[]', 0, 1, 0)`);
}

/** A combatant as the client store holds it — the exact shape the page PATCHes. */
function combatant(overrides: Partial<CombatantWithParsed> = {}): CombatantWithParsed {
  return {
    id: "c-existing",
    encounterId: "enc1",
    name: "Garrick Veldros",
    type: "pc",
    initiative: 18,
    initiativeBonus: 3,
    hpCurrent: 40,
    hpMax: 40,
    hpTemp: 0,
    ac: 16,
    speed: 30,
    conditions: [],
    notes: null,
    isConcentrating: false,
    isVisible: true,
    sortOrder: 0,
    characterId: null,
    ddbCharacterId: null,
    monsterSlug: null,
    statBlock: null,
    ddbCharacter: null,
    avatarUrl: null,
    playerName: null,
    color: null,
    label: null,
    libraryId: null,
    ...overrides,
  } as CombatantWithParsed;
}

function readCombatants(db: TestDb) {
  return db
    .all<{ id: string; hp_current: number; conditions: string; sort_order: number; name: string }>(
      sql`SELECT id, name, hp_current, hp_temp, conditions, is_concentrating, sort_order
          FROM combatants WHERE encounter_id = 'enc1' ORDER BY sort_order`
    );
}

describe("saveEncounter", () => {
  it("persists HP, conditions and concentration for a combatant that already has a row", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", {
      combatants: [
        combatant({ hpCurrent: 12, hpTemp: 5, conditions: ["poisoned"], isConcentrating: true }),
      ],
    });

    const rows = readCombatants(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "c-existing",
      hp_current: 12,
      hp_temp: 5,
      conditions: '["poisoned"]',
      is_concentrating: 1,
    });
  });

  it("persists encounter-level turn state", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", {
      status: "active",
      round: 4,
      currentCombatantId: "c-existing",
      notes: "They fled toward the ford.",
    });

    const enc = db.get<{ status: string; round: number; current_combatant_id: string; notes: string }>(
      sql`SELECT status, round, current_combatant_id, notes FROM encounters WHERE id = 'enc1'`
    );
    expect(enc).toMatchObject({
      status: "active",
      round: 4,
      current_combatant_id: "c-existing",
      notes: "They fled toward the ford.",
    });
  });

  // The add-combatant dialog puts a combatant in the store under a client-generated
  // id. Anything that leaves the store holding an id the DB has no row for — that
  // dialog, or a save racing the POST — must still persist, not silently vanish.
  it("inserts a combatant the client holds but the DB has no row for", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", {
      combatants: [
        combatant(),
        combatant({
          id: "c-client-only",
          name: "Hobgoblin Captain",
          type: "monster",
          initiative: 14,
          hpCurrent: 23,
          hpMax: 39,
          conditions: ["frightened"],
          sortOrder: 1,
          monsterSlug: "hobgoblin-captain",
        }),
      ],
    });

    const rows = readCombatants(db);
    expect(rows.map((r) => r.id)).toEqual(["c-existing", "c-client-only"]);
    expect(rows[1]).toMatchObject({
      name: "Hobgoblin Captain",
      hp_current: 23,
      conditions: '["frightened"]',
    });
  });

  it("deletes combatants the client removed", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);
    db.run(sql`INSERT INTO combatants
        (id, encounter_id, name, type, initiative_bonus, hp_current, hp_max, hp_temp, ac, speed, conditions, is_concentrating, is_visible, sort_order)
      VALUES ('c-doomed', 'enc1', 'Goblin', 'monster', 2, 7, 7, 0, 15, 30, '[]', 0, 1, 1)`);

    saveEncounter(db, "enc1", { combatants: [combatant()] });

    expect(readCombatants(db).map((r) => r.id)).toEqual(["c-existing"]);
  });

  it("leaves other encounters' combatants alone", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);
    db.run(sql`INSERT INTO encounters (id, campaign_id, name, status, round, created_at, updated_at)
      VALUES ('enc2', ${campaignId}, 'Other', 'idle', 1, 1, 1)`);
    db.run(sql`INSERT INTO combatants
        (id, encounter_id, name, type, initiative_bonus, hp_current, hp_max, hp_temp, ac, speed, conditions, is_concentrating, is_visible, sort_order)
      VALUES ('c-other', 'enc2', 'Bystander', 'npc', 0, 5, 5, 0, 10, 30, '[]', 0, 1, 0)`);

    saveEncounter(db, "enc1", { combatants: [] });

    const other = db.all<{ id: string }>(sql`SELECT id FROM combatants WHERE encounter_id = 'enc2'`);
    expect(other.map((r) => r.id)).toEqual(["c-other"]);
  });

  // The unload flush sends only the live combat fields. If an omitted field were
  // treated as "set to null", one refresh would strip every stat block and
  // cached D&D Beyond sheet in the encounter.
  it("leaves fields the payload omits exactly as they are", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);
    db.run(sql`UPDATE combatants
      SET stat_block = '{"name":"Garrick Veldros"}',
          ddb_character_data = '{"id":1,"name":"Garrick"}',
          avatar_url = 'http://example/a.png',
          player_name = 'Zach',
          monster_slug = 'none'
      WHERE id = 'c-existing'`);

    // Exactly what combatSnapshot() produces: no statBlock, no ddbCharacter.
    saveEncounter(db, "enc1", {
      combatants: [
        {
          id: "c-existing",
          name: "Garrick Veldros",
          type: "pc",
          hpCurrent: 3,
          conditions: ["prone"],
          isConcentrating: false,
          isVisible: true,
          sortOrder: 0,
        },
      ],
    });

    const row = db.get<Record<string, unknown>>(
      sql`SELECT hp_current, conditions, stat_block, ddb_character_data, avatar_url, player_name, monster_slug
          FROM combatants WHERE id = 'c-existing'`
    );
    expect(row).toMatchObject({
      hp_current: 3,
      conditions: '["prone"]',
      // untouched:
      stat_block: '{"name":"Garrick Veldros"}',
      ddb_character_data: '{"id":1,"name":"Garrick"}',
      avatar_url: "http://example/a.png",
      player_name: "Zach",
      monster_slug: "none",
    });
  });

  it("does not invent a row from a partial payload that never names the combatant", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", {
      combatants: [combatant(), { id: "ghost-id", hpCurrent: 4 }],
    });

    expect(readCombatants(db).map((r) => r.id)).toEqual(["c-existing"]);
  });

  it("reports a missing encounter instead of silently succeeding", () => {
    const { db } = createTestDb();
    expect(saveEncounter(db, "nope", { round: 2 })).toEqual({ ok: false, reason: "not-found" });
  });

  it("bumps updatedAt", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", { round: 2 });

    const enc = db.get<{ updated_at: number }>(sql`SELECT updated_at FROM encounters WHERE id = 'enc1'`);
    expect(enc!.updated_at).toBeGreaterThan(1);
  });

  it("persists label, libraryId and color", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);
    db.run(sql`INSERT INTO character_library (id, name, type, data, tags, created_at)
      VALUES ('lib-1', 'Hobgoblin Captain', 'monster', '{}', '[]', 1)`);

    saveEncounter(db, "enc1", {
      combatants: [combatant({ label: "on the roof", libraryId: "lib-1", color: "#c0392b" })],
    });

    const row = db.get<Record<string, unknown>>(
      sql`SELECT label, library_id, color FROM combatants WHERE id = 'c-existing'`
    );
    expect(row).toEqual({ label: "on the roof", library_id: "lib-1", color: "#c0392b" });
  });

  it("leaves an existing label alone when the payload omits it", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);
    db.run(sql`UPDATE combatants SET label = 'on the roof' WHERE id = 'c-existing'`);

    saveEncounter(db, "enc1", {
      combatants: [{ id: "c-existing", name: "Garrick Veldros", type: "pc", hpCurrent: 3 }],
    });

    const row = db.get<{ label: string }>(sql`SELECT label FROM combatants WHERE id = 'c-existing'`);
    expect(row.label).toBe("on the roof");
  });

  it("writes null for a libraryId whose entry was deleted, so the rest of the save still lands", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    const result = saveEncounter(db, "enc1", {
      combatants: [combatant({ hpCurrent: 5, libraryId: "lib-gone" })],
    });

    expect(result).toEqual({ ok: true });
    const row = db.get<{ hp_current: number; library_id: string | null }>(
      sql`SELECT hp_current, library_id FROM combatants WHERE id = 'c-existing'`
    );
    expect(row).toEqual({ hp_current: 5, library_id: null });
  });

  it("does the same for a combatant it has to insert", () => {
    const { db, campaignId } = createTestDb();
    seedEncounter(db, campaignId);

    saveEncounter(db, "enc1", {
      combatants: [combatant(), combatant({ id: "c-new", name: "Goblin", libraryId: "lib-gone" })],
    });

    const row = db.get<{ library_id: string | null }>(sql`SELECT library_id FROM combatants WHERE id = 'c-new'`);
    expect(row.library_id).toBeNull();
  });
});
