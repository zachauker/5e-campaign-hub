import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id),
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
  characterId: text("character_id"),
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

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["pc", "npc"] }).notNull(),
  ddbCharacterId: text("ddb_character_id"),
  notionUrl: text("notion_url"),
  description: text("description"),
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  type: text("type", { enum: ["city", "town", "poi", "region", "other"] }).notNull().default("other"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const factions = sqliteTable("factions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const notionSources = sqliteTable(
  "notion_sources",
  {
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["characters", "items", "factions"] }).notNull(),
    databaseUrl: text("database_url").notNull(),
    dataSourceId: text("data_source_id"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    lastStatus: text("last_status"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.entityType] })]
);

export const characterFactions = sqliteTable(
  "character_factions",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    factionId: text("faction_id").notNull().references(() => factions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.factionId] })]
);

export const characterLocations = sqliteTable(
  "character_locations",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.locationId] })]
);

export const characterItems = sqliteTable(
  "character_items",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.itemId] })]
);

export const maps = sqliteTable("maps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  parentMapId: text("parent_map_id"),
  renderMode: text("render_mode", { enum: ["static", "tiled", "world"] }).notNull().default("static"),
  width: integer("width"),
  height: integer("height"),
  maxZoom: integer("max_zoom"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mapMarkers = sqliteTable("map_markers", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  x: real("x").notNull(),
  y: real("y").notNull(),
  type: text("type", { enum: ["location", "faction", "character", "submap", "note"] }).notNull(),
  entityId: text("entity_id"),
  targetMapId: text("target_map_id"),
  title: text("title"),
  note: text("note"),
  minZoom: integer("min_zoom"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
export type Combatant = typeof combatants.$inferSelect;
export type NewCombatant = typeof combatants.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type MonsterCache = typeof monsterCache.$inferSelect;
export type CharacterLibraryEntry = typeof characterLibrary.$inferSelect;
export type NewCharacterLibraryEntry = typeof characterLibrary.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Faction = typeof factions.$inferSelect;
export type NewFaction = typeof factions.$inferInsert;
export type NotionSource = typeof notionSources.$inferSelect;
export type NewNotionSource = typeof notionSources.$inferInsert;
export type MapRow = typeof maps.$inferSelect;
export type NewMapRow = typeof maps.$inferInsert;
export type MapMarker = typeof mapMarkers.$inferSelect;
export type NewMapMarker = typeof mapMarkers.$inferInsert;
