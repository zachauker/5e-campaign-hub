/**
 * Regression test for the save bug: encounter changes were lost on refresh.
 *
 * Drives the real route handlers so it covers the whole round trip the tracker
 * page makes — POST a combatant from the add dialog, PATCH the fight's state,
 * GET it back the way a refresh does. The module-level `db` in `@/lib/db`
 * resolves lazily, so `createTestDb()` (which sets DB_PATH) must run first.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-helpers";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/encounters/enc1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("encounter save round trip", () => {
  it("keeps combat state across a refresh, including added and removed combatants", async () => {
    const { db, campaignId } = createTestDb();
    const { POST: addCombatant } = await import("@/app/api/encounters/[id]/combatants/route");
    const { GET, PATCH } = await import("@/app/api/encounters/[id]/route");

    db.run(sql`INSERT INTO encounters (id, campaign_id, name, status, round, created_at, updated_at)
      VALUES ('enc1', ${campaignId}, 'Ambush on the Ashkeeper Road', 'idle', 1, 1, 1)`);
    db.run(sql`INSERT INTO combatants
        (id, encounter_id, name, type, initiative, initiative_bonus, hp_current, hp_max, hp_temp, ac, speed, conditions, is_concentrating, is_visible, sort_order)
      VALUES ('pc-garrick', 'enc1', 'Garrick Veldros', 'pc', 18, 3, 40, 40, 0, 16, 30, '[]', 0, 1, 0)`);
    db.run(sql`INSERT INTO combatants
        (id, encounter_id, name, type, initiative, initiative_bonus, hp_current, hp_max, hp_temp, ac, speed, conditions, is_concentrating, is_visible, sort_order)
      VALUES ('goblin-1', 'enc1', 'Goblin', 'monster', 9, 2, 7, 7, 0, 15, 30, '[]', 0, 1, 2)`);

    // The add-combatant dialog puts the combatant in the store under an id it
    // mints itself, then POSTs it. The row must land under that same id.
    const clientId = "client-minted-hobgoblin";
    const added = await addCombatant(
      jsonRequest("POST", {
        id: clientId,
        name: "Hobgoblin Captain",
        type: "monster",
        initiative: 14,
        initiativeBonus: 2,
        hpCurrent: 39,
        hpMax: 39,
        ac: 17,
        conditions: [],
        sortOrder: 1,
        monsterSlug: "hobgoblin-captain",
      }),
      ctx("enc1")
    );
    expect(added.status).toBe(201);
    expect((await added.json()).id).toBe(clientId);

    // Three rounds in: the hobgoblin is bloodied and frightened, the goblin is gone.
    const loaded = await (await GET(new Request("http://localhost"), ctx("enc1"))).json();
    const combatants = loaded.combatants
      .filter((c: { id: string }) => c.id !== "goblin-1")
      .map((c: { id: string }) =>
        c.id === clientId
          ? { ...c, hpCurrent: 11, conditions: ["frightened"], isConcentrating: true }
          : c
      );

    const saved = await PATCH(
      jsonRequest("PATCH", {
        status: "active",
        round: 3,
        currentCombatantId: clientId,
        combatants,
      }),
      ctx("enc1")
    );
    expect(saved.status).toBe(200);

    // Refresh.
    const after = await (await GET(new Request("http://localhost"), ctx("enc1"))).json();
    expect(after).toMatchObject({ status: "active", round: 3, currentCombatantId: clientId });
    expect(after.combatants.map((c: { name: string }) => c.name)).toEqual([
      "Garrick Veldros",
      "Hobgoblin Captain",
    ]);
    expect(after.combatants.find((c: { id: string }) => c.id === clientId)).toMatchObject({
      hpCurrent: 11,
      conditions: ["frightened"],
      isConcentrating: true,
      monsterSlug: "hobgoblin-captain",
    });

    // A save against an encounter that no longer exists must not report success.
    const ghost = await PATCH(jsonRequest("PATCH", { round: 9 }), ctx("deleted-encounter"));
    expect(ghost.status).toBe(404);
  });
});
