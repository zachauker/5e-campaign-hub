import { describe, it, expect } from "vitest";
import { parseFrontmatter, FrontmatterError } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("splits the --- block from the body", () => {
    const raw = "---\ntype: npc\nname: Manner\n---\n# Manner\n\nA quiet man.\n";
    const { data, body } = parseFrontmatter(raw);
    expect(data.type).toBe("npc");
    expect(data.name).toBe("Manner");
    expect(body.startsWith("# Manner")).toBe(true);
  });

  it("returns an empty body when the note is frontmatter only", () => {
    const { data, body } = parseFrontmatter("---\ntype: location\n---\n");
    expect(data.type).toBe("location");
    expect(body).toBe("");
  });

  it("returns empty data and the whole file as body when there is no --- block", () => {
    const raw = "# Just a heading\n\nSome prose with a - bullet.\n";
    const { data, body } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(body).toBe(raw);
  });

  it("throws FrontmatterError on malformed YAML", () => {
    const raw = "---\ntype: [unclosed\nname: : :\n---\nbody\n";
    expect(() => parseFrontmatter(raw)).toThrow(FrontmatterError);
  });

  it("returns independent data objects for identical input", () => {
    const raw = "---\ntype: npc\n---\nbody\n";
    const a = parseFrontmatter(raw);
    a.data.type = "mutated";
    expect(parseFrontmatter(raw).data.type).toBe("npc");
  });
});
