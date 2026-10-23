/**
 * The D&D Beyond character id in a sheet link, or null when there isn't one.
 *
 * Accepts every link form DDB hands out: `dndbeyond.com/characters/<id>`,
 * `dndbeyond.com/profile/<user>/characters/<id>`, the short link
 * `ddb.ac/characters/<id>/<slug>`, and a bare numeric id. The path segment is
 * what is matched, not the host, so a new DDB domain doesn't need a code change.
 *
 * Shared by the public-sheet fetcher and the vault sync so the two readers can
 * never disagree about what counts as a D&D Beyond character.
 */
export function parseDdbCharacterId(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.match(/\/characters\/(\d+)/) ?? input.trim().match(/^(\d+)$/);
  return match ? match[1] : null;
}
