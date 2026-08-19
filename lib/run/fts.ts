/**
 * Build an FTS5 MATCH expression from raw DM input.
 *
 * Everything outside [a-z0-9] is dropped rather than escaped: FTS5 treats `"`,
 * `*`, `(`, `-`, `OR`, and `NEAR` as syntax, and a stray one raises a SQLite
 * error rather than returning no rows. At the table there is no room for a
 * query that throws, so the input is reduced to plain lowercase tokens and each
 * is quoted and given the prefix operator.
 *
 * Returns null when nothing usable survives — callers should return no results
 * rather than issuing a MATCH.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}
