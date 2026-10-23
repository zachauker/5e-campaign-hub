import type { PropEntry } from "./map";

/**
 * Decode a `source_props` column (a JSON array of `{ label, value }`) for an API
 * response. Anything that is not that shape yields `[]`, so a hand-edited or
 * truncated value cannot take down a detail page.
 */
export function parseSourceProps(json: string | null | undefined): PropEntry[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (p): p is PropEntry =>
      typeof p === "object" && p !== null && typeof p.label === "string" && typeof p.value === "string",
  );
}
