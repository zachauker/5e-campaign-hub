import matter from "gray-matter";

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

/**
 * Split a note into its YAML frontmatter and markdown body. A note with no
 * `---` block is valid (empty data, whole file as body); only malformed YAML throws.
 */
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  try {
    // Passing an options object opts out of gray-matter's global content-keyed
    // cache, which would otherwise hand every caller the same shared `data` object.
    const parsed = matter(raw, {});
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new FrontmatterError(`Malformed frontmatter: ${reason}`);
  }
}
