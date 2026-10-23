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
  // Absolute integer day number (not a timestamp) rendered by lib/calendar/exandria.ts.
  inWorldDay: integer("in_world_day"),
  calendarEpochLabel: text("calendar_epoch_label"),
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
  sourceKey: text("source_key"),
  sourcePath: text("source_path"),
  sourceProps: text("source_props"),
  sourceSyncedAt: integer("source_synced_at", { mode: "timestamp" }),
  sourceHash: text("source_hash"),
  sourceText: text("source_text"),
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
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  sourceKey: text("source_key"),
  sourcePath: text("source_path"),
  sourceProps: text("source_props"),
  sourceSyncedAt: integer("source_synced_at", { mode: "timestamp" }),
  sourceHash: text("source_hash"),
  sourceText: text("source_text"),
  // No .references() by design: the parent comes from a vault wikilink resolved
  // at sync time, so the id may dangle — same rationale as thread_links.
  parentLocationId: text("parent_location_id"),
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
  sourceKey: text("source_key"),
  sourcePath: text("source_path"),
  sourceProps: text("source_props"),
  sourceSyncedAt: integer("source_synced_at", { mode: "timestamp" }),
  sourceHash: text("source_hash"),
  sourceText: text("source_text"),
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
  sourceKey: text("source_key"),
  sourcePath: text("source_path"),
  sourceProps: text("source_props"),
  sourceSyncedAt: integer("source_synced_at", { mode: "timestamp" }),
  sourceHash: text("source_hash"),
  sourceText: text("source_text"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessionNotes = sqliteTable("session_notes", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  noteType: text("note_type"),          // derived from the vault `type:` (see lib/vault/map.ts)
  status: text("status"),                // frontmatter `status`
  date: text("date"),                    // ISO date string "2026-07-19" — text, not a timestamp
  arc: text("arc"),                      // frontmatter `arc` (wikilink name)
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  sourceKey: text("source_key"),
  sourcePath: text("source_path"),
  sourceProps: text("source_props"),
  sourceSyncedAt: integer("source_synced_at", { mode: "timestamp" }),
  sourceHash: text("source_hash"),
  sourceText: text("source_text"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessionNoteLocations = sqliteTable(
  "session_note_locations",
  {
    sessionNoteId: text("session_note_id").notNull().references(() => sessionNotes.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sessionNoteId, t.locationId] })]
);

// Dead since the move to the Obsidian vault: nothing reads or writes this table.
// Kept (like the notion_* columns) because migrations are additive-only.
export const notionSources = sqliteTable(
  "notion_sources",
  {
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["characters", "items", "factions", "locations", "sessionNotes"] }).notNull(),
    databaseUrl: text("database_url").notNull(),
    dataSourceId: text("data_source_id"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    lastStatus: text("last_status"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.entityType] })]
);

export const vaultSources = sqliteTable("vault_sources", {
  campaignId: text("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  rootPath: text("root_path").notNull(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  lastStatus: text("last_status"),
});

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
  type: text("type", { enum: ["location", "faction", "character", "submap", "note", "event"] }).notNull(),
  entityId: text("entity_id"),
  targetMapId: text("target_map_id"),
  title: text("title"),
  note: text("note"),
  minZoom: integer("min_zoom"),
  size: text("size"),
  shape: text("shape"),
  icon: text("icon"),
  labelSize: text("label_size"),
  color: text("color"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const referenceCollections = sqliteTable("reference_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sourceType: text("source_type", { enum: ["srd", "pdf", "text"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  chunkCount: integer("chunk_count").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const referenceChunks = sqliteTable("reference_chunks", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull().references(() => referenceCollections.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  sourceRef: text("source_ref").notNull(),
  ordinal: integer("ordinal").notNull(),
  tokenCount: integer("token_count").notNull(),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  stakes: text("stakes"),
  // open | dormant | resolved | abandoned. Set manually; nothing auto-dormants on staleness.
  status: text("status").notNull().default("open"),
  // Deliberately no .references(): deleting the session note that opened/resolved
  // this thread must not cascade away the thread's history. Ids may dangle.
  openedSessionId: text("opened_session_id"),
  resolvedSessionId: text("resolved_session_id"),
  openedOnDay: integer("opened_on_day"),
  lastTouchedDay: integer("last_touched_day"),
  notes: text("notes"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const threadLinks = sqliteTable("thread_links", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  // character | location | item | faction | session
  targetKind: text("target_kind").notNull(),
  // Polymorphic (its table depends on targetKind), so it cannot carry a single
  // FK target. No .references() by design. Ids may dangle.
  targetId: text("target_id").notNull(),
  // subject | stakeholder | obstacle
  role: text("role").notNull().default("subject"),
});

export const clocks = sqliteTable("clocks", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  segments: integer("segments").notNull().default(8),
  filled: integer("filled").notNull().default(0),
  // faction | location | thread | null
  ownerKind: text("owner_kind"),
  ownerId: text("owner_id"),
  // in-world days per automatic tick; null = manual only
  cadenceDays: integer("cadence_days"),
  lastTickedDay: integer("last_ticked_day"),
  // running | paused | complete
  status: text("status").notNull().default("running"),
  payoff: text("payoff"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const timelineEvents = sqliteTable("timeline_events", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  day: integer("day").notNull(),
  // thread_opened | thread_resolved | clock_ticked | clock_completed | date_advanced | session_played | note
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  // manual | proposal | cadence
  sourceKind: text("source_kind").notNull().default("manual"),
  // Deliberately no .references(): deleting a thread or clock must not cascade
  // away timeline history. Ids may dangle.
  threadId: text("thread_id"),
  clockId: text("clock_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const sessionReviews = sqliteTable("session_reviews", {
  id: text("id").primaryKey(),
  sessionNoteId: text("session_note_id").notNull(),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }).notNull(),
  contentHash: text("content_hash").notNull(),
  proposalCount: integer("proposal_count").notNull().default(0),
});

export const entityBriefings = sqliteTable("entity_briefings", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  // character | location | item | faction
  targetKind: text("target_kind").notNull(),
  // Polymorphic (its table depends on targetKind), so it cannot carry a single
  // FK target. No .references() by design. Ids may dangle.
  targetId: text("target_id").notNull(),
  identity: text("identity"),
  wants: text("wants"),
  partyKnows: text("party_knows"),
  // DM-only. Never indexed for search and never rendered on the default card.
  secret: text("secret"),
  voice: text("voice"),
  // JSON array of strings.
  aliases: text("aliases").notNull().default("[]"),
  sourceHash: text("source_hash").notNull(),
  // JSON array of field names the DM edited by hand; a rebuild leaves these alone.
  manualFields: text("manual_fields").notNull().default("[]"),
  // True when built without the vault note body — either the read failed or
  // the note had no readable content. Not specifically "the vault was unreachable".
  partial: integer("partial", { mode: "boolean" }).notNull().default(false),
  builtAt: integer("built_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const runSessions = sqliteTable("run_sessions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  label: text("label"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  // Deliberately no .references(): linked once the transcript lands, and
  // deleting that note must not cascade away the run. Same rationale as
  // threads.openedSessionId. Ids may dangle.
  sessionNoteId: text("session_note_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const sessionMarks = sqliteTable("session_marks", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  runSessionId: text("run_session_id").notNull().references(() => runSessions.id, { onDelete: "cascade" }),
  // Milliseconds since the run started.
  atMs: integer("at_ms").notNull(),
  wallClock: integer("wall_clock", { mode: "timestamp" }).notNull(),
  // npc | promise | loot | lore | todo | null
  tag: text("tag"),
  note: text("note"),
  // What was on screen: an entity kind, "encounter", or null. Polymorphic, so
  // no .references() — same rationale as thread_links.
  contextKind: text("context_kind"),
  contextId: text("context_id"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // Client-generated. Lets createMark() dedupe a retried write that succeeded
  // server-side but whose response was lost — see lib/run/marks.ts. Nullable:
  // rows written before this column existed have none.
  localId: text("local_id"),
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
export type SessionNote = typeof sessionNotes.$inferSelect;
export type NewSessionNote = typeof sessionNotes.$inferInsert;
export type NotionSource = typeof notionSources.$inferSelect;
export type NewNotionSource = typeof notionSources.$inferInsert;
export type VaultSource = typeof vaultSources.$inferSelect;
export type NewVaultSource = typeof vaultSources.$inferInsert;
export type MapRow = typeof maps.$inferSelect;
export type NewMapRow = typeof maps.$inferInsert;
export type MapMarker = typeof mapMarkers.$inferSelect;
export type NewMapMarker = typeof mapMarkers.$inferInsert;
export type ReferenceCollection = typeof referenceCollections.$inferSelect;
export type NewReferenceCollection = typeof referenceCollections.$inferInsert;
export type ReferenceChunk = typeof referenceChunks.$inferSelect;
export type NewReferenceChunk = typeof referenceChunks.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type ThreadLink = typeof threadLinks.$inferSelect;
export type NewThreadLink = typeof threadLinks.$inferInsert;
export type Clock = typeof clocks.$inferSelect;
export type NewClock = typeof clocks.$inferInsert;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type NewTimelineEvent = typeof timelineEvents.$inferInsert;
export type SessionReview = typeof sessionReviews.$inferSelect;
export type NewSessionReview = typeof sessionReviews.$inferInsert;
export type EntityBriefing = typeof entityBriefings.$inferSelect;
export type NewEntityBriefing = typeof entityBriefings.$inferInsert;
export type RunSession = typeof runSessions.$inferSelect;
export type NewRunSession = typeof runSessions.$inferInsert;
export type SessionMark = typeof sessionMarks.$inferSelect;
export type NewSessionMark = typeof sessionMarks.$inferInsert;
