import { extractNotionPageId } from "./client";
import {
  readTitle, readText, readSelect, readMultiSelect,
  readCheckbox, readNumber, readUrl, readRelationIds, extractDdbId,
} from "./props";

export type PropEntry = { label: string; value: string };

export interface MappedEntity {
  notionPageId: string;
  notionUrl: string;
  name: string;
  archived: boolean;
  notionProps: PropEntry[];
  extra: Record<string, unknown>;
  affiliations?: string[];
  heldByPageIds?: string[];
  notableNpcPageIds?: string[];
}

export interface NotionRow {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

type P = Record<string, unknown> | undefined;
function prop(row: NotionRow, name: string): P {
  return row.properties[name] as P;
}
function pushIf(list: PropEntry[], label: string, value: string | number | null): void {
  if (value !== null && value !== undefined && String(value).length > 0) {
    list.push({ label, value: String(value) });
  }
}
function pageId(row: NotionRow): string {
  return extractNotionPageId(row.url) ?? row.id.replace(/-/g, "");
}

export function mapFactionRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Alignment", readSelect(prop(row, "Alignment Toward Party")));
  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: !readCheckbox(prop(row, "Active")),
    notionProps: props,
    extra: {},
  };
}

export function mapCharacterRow(row: NotionRow): MappedEntity {
  const sheetUrl = readUrl(prop(row, "Character Sheet"));
  const ddbCharacterId = extractDdbId(sheetUrl);

  const props: PropEntry[] = [];
  pushIf(props, "Race", readSelect(prop(row, "Race")));
  pushIf(props, "Class", readMultiSelect(prop(row, "Class")).join(", "));
  pushIf(props, "Level", readNumber(prop(row, "Character Level")));
  pushIf(props, "Disposition", readSelect(prop(row, "Disposition Toward Party")));
  pushIf(props, "Role/Title", readText(prop(row, "Role/Title")));
  if (sheetUrl && !ddbCharacterId) pushIf(props, "Character Sheet", sheetUrl);

  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: !readCheckbox(prop(row, "Active")),
    notionProps: props,
    extra: { type: readSelect(prop(row, "Type")) === "Player" ? "pc" : "npc", ddbCharacterId },
    affiliations: readMultiSelect(prop(row, "Affiliations")),
  };
}

export function mapItemRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Rarity", readSelect(prop(row, "Rarity")));
  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: false, // Items & Loot has no Active property
    notionProps: props,
    extra: { description: readText(prop(row, "Description")) || null },
    heldByPageIds: readRelationIds(prop(row, "Held By")),
  };
}

export function mapLocationRow(row: NotionRow): MappedEntity {
  const props: PropEntry[] = [];
  pushIf(props, "Type", readSelect(prop(row, "Type")));
  pushIf(props, "Status", readSelect(prop(row, "Status")));
  pushIf(props, "Region", readSelect(prop(row, "Region")));

  // Notion wins only if non-empty: omit description from `extra` when blank so
  // reconcile never overwrites existing (often world-composed) text with "".
  const description = readText(prop(row, "Description"));
  const extra: Record<string, unknown> = {};
  if (description) extra.description = description;

  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: false, // Locations has no Active property; removal drives archival
    notionProps: props,
    extra, // never contains `type` → hub type stays world-authoritative
    notableNpcPageIds: readRelationIds(prop(row, "Notable NPCs")),
  };
}
