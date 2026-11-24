import { and, eq, notInArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { combatants, encounters } from "@/lib/db/schema";
import type { CombatantWithParsed } from "@/lib/types";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type CombatantInsert = typeof combatants.$inferInsert;

const STATUSES = ["idle", "active", "completed"] as const;
type Status = (typeof STATUSES)[number];

/** A combatant as the tracker sends it: always an id, every other field optional. */
export type CombatantSave = Partial<CombatantWithParsed> & { id: string };

export interface EncounterSavePayload {
  status?: Status;
  round?: number;
  currentCombatantId?: string | null;
  notes?: string | null;
  /**
   * The client's complete combatant list for this encounter. Treated as
   * authoritative: rows missing from it are deleted. Individual combatants may
   * be partial — the unload flush sends only the live combat fields to stay
   * inside the keepalive body limit — and an omitted field is left as it is.
   */
  combatants?: CombatantSave[];
}

export type SaveResult = { ok: true } | { ok: false; reason: "not-found" };

/** Column defaults for a row we have to create rather than update. */
const INSERT_DEFAULTS = {
  type: "monster" as const,
  initiativeBonus: 0,
  hpCurrent: 0,
  hpMax: 0,
  hpTemp: 0,
  ac: 10,
  speed: 30,
  conditions: "[]",
  isConcentrating: false,
  isVisible: true,
  sortOrder: 0,
};

/**
 * The row values a combatant payload asks to write. Only keys the payload
 * actually carries are included, so a partial save leaves everything else
 * alone — sending the slim snapshot must never blank a stat block or a cached
 * D&D Beyond sheet.
 */
function combatantPatch(c: CombatantSave): Partial<CombatantInsert> {
  const patch: Partial<CombatantInsert> = {};
  if (c.name !== undefined) patch.name = c.name;
  if (c.type !== undefined) patch.type = c.type;
  if (c.initiative !== undefined) patch.initiative = c.initiative;
  if (c.initiativeBonus !== undefined) patch.initiativeBonus = c.initiativeBonus;
  if (c.hpCurrent !== undefined) patch.hpCurrent = c.hpCurrent;
  if (c.hpMax !== undefined) patch.hpMax = c.hpMax;
  if (c.hpTemp !== undefined) patch.hpTemp = c.hpTemp;
  if (c.ac !== undefined) patch.ac = c.ac;
  if (c.speed !== undefined) patch.speed = c.speed;
  if (c.conditions !== undefined) patch.conditions = JSON.stringify(c.conditions ?? []);
  if (c.notes !== undefined) patch.notes = c.notes;
  if (c.isConcentrating !== undefined) patch.isConcentrating = c.isConcentrating;
  if (c.isVisible !== undefined) patch.isVisible = c.isVisible;
  if (c.sortOrder !== undefined) patch.sortOrder = c.sortOrder;
  if (c.characterId !== undefined) patch.characterId = c.characterId;
  if (c.ddbCharacterId !== undefined) patch.ddbCharacterId = c.ddbCharacterId;
  if (c.monsterSlug !== undefined) patch.monsterSlug = c.monsterSlug;
  if (c.statBlock !== undefined) {
    patch.statBlock = c.statBlock ? JSON.stringify(c.statBlock) : null;
  }
  if (c.ddbCharacter !== undefined) {
    patch.ddbCharacterData = c.ddbCharacter ? JSON.stringify(c.ddbCharacter) : null;
  }
  if (c.avatarUrl !== undefined) patch.avatarUrl = c.avatarUrl;
  if (c.playerName !== undefined) patch.playerName = c.playerName;
  if (c.color !== undefined) patch.color = c.color;
  if (c.label !== undefined) patch.label = c.label;
  if (c.libraryId !== undefined) patch.libraryId = c.libraryId;
  return patch;
}

/**
 * Writes the tracker's state for one encounter.
 *
 * The combatant list is reconciled rather than updated row by row: each
 * combatant is written under the id the client holds — inserted if the DB has
 * no such row — and rows the client no longer has are deleted. An update-only
 * save silently dropped every edit to a combatant whose id the DB didn't
 * recognise (the add-combatant dialog mints the id client-side), and never
 * persisted removals at all.
 */
export function saveEncounter(
  db: Db,
  encounterId: string,
  payload: EncounterSavePayload
): SaveResult {
  const exists = db
    .select({ id: encounters.id })
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .all();
  if (exists.length === 0) return { ok: false, reason: "not-found" };

  const list = Array.isArray(payload.combatants) ? payload.combatants : null;

  db.transaction((tx) => {
    tx.update(encounters)
      .set({
        ...(STATUSES.includes(payload.status as Status) ? { status: payload.status } : {}),
        ...(typeof payload.round === "number" ? { round: payload.round } : {}),
        ...(payload.currentCombatantId !== undefined
          ? { currentCombatantId: payload.currentCombatantId }
          : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(encounters.id, encounterId))
      .run();

    if (!list) return;

    const present = new Set(
      tx
        .select({ id: combatants.id })
        .from(combatants)
        .where(eq(combatants.encounterId, encounterId))
        .all()
        .map((r) => r.id)
    );

    for (const c of list) {
      if (!c?.id) continue;
      const patch = combatantPatch(c);

      if (present.has(c.id)) {
        if (Object.keys(patch).length === 0) continue;
        tx.update(combatants).set(patch).where(eq(combatants.id, c.id)).run();
        continue;
      }

      // No row yet. Only create one from a payload that names the combatant —
      // a slim flush referring to a row that never landed shouldn't invent a
      // nameless placeholder.
      if (patch.name === undefined) continue;
      tx.insert(combatants)
        .values({ ...INSERT_DEFAULTS, ...patch, id: c.id, encounterId, name: patch.name })
        .run();
    }

    const keep = list.map((c) => c?.id).filter((id): id is string => Boolean(id));
    tx.delete(combatants)
      .where(
        keep.length > 0
          ? and(eq(combatants.encounterId, encounterId), notInArray(combatants.id, keep))
          : eq(combatants.encounterId, encounterId)
      )
      .run();
  });

  return { ok: true };
}
