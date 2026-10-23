/**
 * Settings keys whose values must never reach the client. `GET /api/settings`
 * returns every row (the vault panel reads the legacy `notion_auto_sync_*` keys
 * through it), so this list, not the write allow-list, is what keeps secrets out.
 *
 * `notion_token` stays here although nothing writes or reads it any more: an
 * upgraded database may still hold the row, and unmasked it would be served in
 * clear text.
 */
export const MASKED_KEYS: ReadonlySet<string> = new Set(["ddb_cobalt_token", "notion_token", "anthropic_api_key"]);

export function maskSettings(rows: ReadonlyArray<{ key: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = MASKED_KEYS.has(row.key) ? (row.value ? "configured" : "") : row.value;
  }
  return result;
}
