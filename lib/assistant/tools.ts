import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AppDb, EntityKind } from "./read-tools";
import { searchEntities, listEntities, getEntity, getRelationships, listMonsters, getMapContext } from "./read-tools";
import { buildEncounterProposal, buildEntityProposal, buildMarkerProposal, buildNotionSyncProposal } from "./proposals";
import { searchReference } from "@/lib/reference/retrieve";
import { embed } from "@/lib/reference/embed";

const kindEnum = z.enum(["character", "location", "item", "faction"]);
const j = (v: unknown) => JSON.stringify(v);

export function buildTools(db: AppDb, campaignId: string) {
  return [
    betaZodTool({
      name: "search_entities",
      description: "Search characters, locations, items, and factions by name. Call this whenever the user names a person, place, thing, or group so you can resolve it to an id before answering.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(searchEntities(db, campaignId, { query })),
    }),
    betaZodTool({
      name: "list_entities",
      description: "List all entities of one kind for the campaign, optionally filtered by type. Use for 'list all X' questions.",
      inputSchema: z.object({ kind: kindEnum, type: z.string().optional() }),
      run: async ({ kind, type }) => j(listEntities(db, campaignId, { kind: kind as EntityKind, type })),
    }),
    betaZodTool({
      name: "get_entity",
      description: "Get the full record for one entity by kind + id, including description and Notion properties. Call after search_entities to answer detail questions.",
      inputSchema: z.object({ kind: kindEnum, id: z.string() }),
      run: async ({ kind, id }) => j(getEntity(db, campaignId, { kind: kind as EntityKind, id })),
    }),
    betaZodTool({
      name: "get_relationships",
      description: "Reverse relationship lookup: which characters belong to a faction, are in a location, or hold an item.",
      inputSchema: z.object({ kind: kindEnum, id: z.string() }),
      run: async ({ kind, id }) => j(getRelationships(db, campaignId, { kind: kind as EntityKind, id })),
    }),
    betaZodTool({
      name: "list_monsters",
      description: "Search the cached monster library by name for encounter building. Returns slug, name, and challenge rating.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(listMonsters(db, { query })),
    }),
    betaZodTool({
      name: "get_map_context",
      description: "Get a map's markers and linked entities by map id. Use when the user asks about what is on a map or wants to place a marker.",
      inputSchema: z.object({ mapId: z.string() }),
      run: async ({ mapId }) => j(getMapContext(db, campaignId, { mapId })),
    }),
    betaZodTool({
      name: "search_reference",
      description: "Search indexed rulebooks and setting sourcebooks (SRD rules, loaded campaign-setting books, the DM's homebrew notes) for rules, mechanics, or published-setting lore. Call this for ANY rules/mechanics question or published-setting question, and cite the returned sources in your answer. Prefer this over answering rules from memory. Returns passages with a `sourceRef` citation each.",
      inputSchema: z.object({ query: z.string(), collection: z.string().optional() }),
      run: async ({ query, collection }) => j(await searchReference(db, { query, embed, collection })),
    }),
    betaZodTool({
      name: "propose_encounter",
      description: "Propose creating a combat encounter with combatants. Does NOT create it — returns a proposal the user must confirm. Use monster stats from list_monsters where possible.",
      inputSchema: z.object({
        name: z.string(),
        notes: z.string().optional(),
        combatants: z.array(z.object({ name: z.string(), type: z.enum(["pc", "npc", "monster"]), hpMax: z.number().optional(), ac: z.number().optional(), initiativeBonus: z.number().optional(), monsterSlug: z.string().optional() })).optional(),
      }),
      run: async (input) => j({ proposal: buildEncounterProposal(campaignId, input) }),
    }),
    betaZodTool({
      name: "propose_entity",
      description: "Propose creating (omit id) or updating (include id) a character/location/item/faction. Only hub-authored fields are accepted; Notion-synced fields are rejected. Returns a proposal to confirm.",
      inputSchema: z.object({ kind: kindEnum, id: z.string().optional(), fields: z.record(z.string(), z.unknown()) }),
      run: async ({ kind, id, fields }) => j({ proposal: buildEntityProposal(campaignId, { kind: kind as EntityKind, id, fields: fields as Record<string, unknown> }) }),
    }),
    betaZodTool({
      name: "propose_marker",
      description: "Propose placing a marker on a map. Returns a proposal to confirm. Get the mapId from get_map_context first.",
      inputSchema: z.object({ mapId: z.string(), x: z.number(), y: z.number(), type: z.enum(["location", "faction", "character", "submap", "note"]), title: z.string().optional(), entityId: z.string().optional(), note: z.string().optional() }),
      run: async (input) => j({ proposal: buildMarkerProposal(input) }),
    }),
    betaZodTool({
      name: "propose_notion_sync",
      description: "Propose running a Notion → hub sync for this campaign. Returns a proposal to confirm.",
      inputSchema: z.object({}),
      run: async () => j({ proposal: buildNotionSyncProposal(campaignId) }),
    }),
  ];
}
