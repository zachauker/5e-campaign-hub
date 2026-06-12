import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["idle", "active", "completed"] }).notNull().default("idle"),
  round: integer("round").notNull().default(1),
  currentCombatantId: text("current_combatant_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const combatants = sqliteTable("combatants", {
  id: text("id").primaryKey(),
  encounterId: text("encounter_id").notNull().references(() => encounters.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["pc", "npc", "monster"] }).notNull(),
  initiative: real("initiative"),
  initiativeBonus: integer("initiative_bonus").notNull().default(0),
  hpCurrent: integer("hp_current").notNull().default(0),
  hpMax: integer("hp_max").notNull().default(0),
  hpTemp: integer("hp_temp").notNull().default(0),
  ac: integer("ac").notNull().default(10),
  speed: integer("speed").notNull().default(30),
  conditions: text("conditions").notNull().default("[]"),
  notes: text("notes"),
  isConcentrating: integer("is_concentrating", { mode: "boolean" }).notNull().default(false),
  isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ddbCharacterId: text("ddb_character_id"),
  monsterSlug: text("monster_slug"),
  statBlock: text("stat_block"),
  ddbCharacterData: text("ddb_character_data"),
  avatarUrl: text("avatar_url"),
  playerName: text("player_name"),
  color: text("color"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const monsterCache = sqliteTable("monster_cache", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  cachedAt: integer("cached_at", { mode: "timestamp" }).notNull(),
});

export const characterLibrary = sqliteTable("character_library", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["pc", "npc", "monster"] }).notNull(),
  data: text("data").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
export type Combatant = typeof combatants.$inferSelect;
export type NewCombatant = typeof combatants.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type MonsterCache = typeof monsterCache.$inferSelect;
export type CharacterLibraryEntry = typeof characterLibrary.$inferSelect;
export type NewCharacterLibraryEntry = typeof characterLibrary.$inferInsert;
