/**
 * The notion_* columns are kept in the database (migrations are additive-only)
 * but nothing reads them. Entity API responses leave them out so the wire shape
 * carries no Notion-era fields.
 */
const LEGACY_KEYS = ["notionUrl", "notionPageId", "notionProps", "notionSyncedAt"] as const;

type LegacyKey = (typeof LEGACY_KEYS)[number];

export function omitLegacyColumns<T extends object>(row: T): Omit<T, LegacyKey> {
  const out = { ...row } as Record<string, unknown>;
  for (const key of LEGACY_KEYS) delete out[key];
  return out as Omit<T, LegacyKey>;
}
