import type { EntityKind } from "./read-tools";

export interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
}

// Only these fields may be written per entity kind. Notion-synced columns
// (type on locations, description on items, notionProps, etc.) are deliberately absent.
export const HUB_AUTHORED: Record<EntityKind, string[]> = {
  character: ["name", "description", "notionUrl"], // NOT `type`/`ddbCharacterId` — sync-managed via mapCharacterRow extra
  location: ["name", "description", "notionUrl"], // NOT `type` — world-derived, drives map layering
  item: ["name", "notionUrl"],                    // NOT `description` — synced from Notion
  faction: ["name", "description", "notionUrl"],
};

export function assertHubAuthored(kind: EntityKind, fields: Record<string, unknown>): void {
  const allowed = HUB_AUTHORED[kind];
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new Error(`Field not hub-authored: ${key} (kind: ${kind})`);
  }
}

export function buildEncounterProposal(campaignId: string, input: { name: string; notes?: string; combatants?: Array<Record<string, unknown>> }): Proposal {
  const combatants = input.combatants ?? [];
  return {
    summary: `Create encounter "${input.name}" with ${combatants.length} combatant(s).`,
    targetRoute: "/api/encounters",
    method: "POST",
    payload: { campaignId, name: input.name, notes: input.notes ?? null, combatants },
  };
}

export function buildEntityProposal(campaignId: string, input: { kind: EntityKind; id?: string; fields: Record<string, unknown> }): Proposal {
  assertHubAuthored(input.kind, input.fields);
  const base = `/api/${input.kind}s`;
  if (input.id) {
    return { summary: `Update ${input.kind} ${input.id}: ${Object.keys(input.fields).join(", ")}.`, targetRoute: `${base}/${input.id}`, method: "PATCH", payload: { ...input.fields } };
  }
  return { summary: `Create ${input.kind} "${String(input.fields.name ?? "?")}".`, targetRoute: base, method: "POST", payload: { campaignId, ...input.fields } };
}

export function buildMarkerProposal(input: { mapId: string; x: number; y: number; type: string; title?: string; entityId?: string; note?: string }): Proposal {
  const { mapId, ...payload } = input;
  return { summary: `Place a ${input.type} marker${input.title ? ` "${input.title}"` : ""} on map ${mapId}.`, targetRoute: `/api/maps/${mapId}/markers`, method: "POST", payload };
}

export function buildNotionSyncProposal(campaignId: string): Proposal {
  return { summary: "Run a Notion → hub sync for this campaign.", targetRoute: "/api/notion/sync", method: "POST", payload: { campaignId } };
}
