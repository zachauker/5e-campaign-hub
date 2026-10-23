import { describe, it, expect } from "vitest";
import { parseWikilink, parseWikilinkList, buildLinkIndex } from "./links";
import type { VaultNote } from "./scan";

function note(
  path: string,
  data: Record<string, unknown> = {},
): VaultNote {
  const file = path.split("/").pop() as string;
  return { path, basename: file.replace(/\.md$/, ""), data, body: "" };
}

describe("parseWikilink", () => {
  it("reads a plain link", () => {
    expect(parseWikilink("[[Rexxentrum]]")).toEqual({
      target: "Rexxentrum",
      label: null,
      heading: null,
    });
  });

  it("reads a labelled link", () => {
    expect(parseWikilink("[[Rexxentrum|the capital]]")).toEqual({
      target: "Rexxentrum",
      label: "the capital",
      heading: null,
    });
  });

  it("reads a heading link", () => {
    expect(parseWikilink("[[Related#NPCs here]]")).toEqual({
      target: "Related",
      label: null,
      heading: "NPCs here",
    });
  });

  it("reads a link carrying both a heading and a label", () => {
    expect(parseWikilink("[[Rexxentrum#Districts|the capital]]")).toEqual({
      target: "Rexxentrum",
      label: "the capital",
      heading: "Districts",
    });
  });

  it("takes the label from the first pipe, so a # inside the label is not a heading", () => {
    expect(parseWikilink("[[Rexxentrum|Floor #3]]")).toEqual({
      target: "Rexxentrum",
      label: "Floor #3",
      heading: null,
    });
  });

  it("accepts a bare name", () => {
    expect(parseWikilink("Rexxentrum")).toEqual({
      target: "Rexxentrum",
      label: null,
      heading: null,
    });
    expect(parseWikilink("Rexxentrum|the capital")).toEqual({
      target: "Rexxentrum",
      label: "the capital",
      heading: null,
    });
  });

  it("trims whitespace around the link and its parts", () => {
    expect(parseWikilink("  [[ Rexxentrum | the capital ]]  ")).toEqual({
      target: "Rexxentrum",
      label: "the capital",
      heading: null,
    });
  });

  it("keeps non-ASCII targets intact", () => {
    expect(parseWikilink("[[Caught in the Web — Children of Malice]]")?.target).toBe(
      "Caught in the Web — Children of Malice",
    );
    expect(parseWikilink("[[Dwendal’s Gambit]]")?.target).toBe("Dwendal’s Gambit");
    expect(parseWikilink("[[Hearth & Hammer]]")?.target).toBe("Hearth & Hammer");
  });

  it("returns null for empty input", () => {
    expect(parseWikilink("")).toBeNull();
    expect(parseWikilink("   ")).toBeNull();
    expect(parseWikilink("[[]]")).toBeNull();
    expect(parseWikilink("[[ ]]")).toBeNull();
  });

  it("returns null when there is no target to link to", () => {
    expect(parseWikilink("[[|just a label]]")).toBeNull();
    expect(parseWikilink("[[#Heading only]]")).toBeNull();
  });

  it("treats an empty label or heading as absent", () => {
    expect(parseWikilink("[[Rexxentrum|]]")).toEqual({
      target: "Rexxentrum",
      label: null,
      heading: null,
    });
    expect(parseWikilink("[[Rexxentrum#]]")).toEqual({
      target: "Rexxentrum",
      label: null,
      heading: null,
    });
  });
});

describe("parseWikilinkList", () => {
  it("handles a single string, an array, and undefined", () => {
    expect(parseWikilinkList("[[Druvenlode]]")).toEqual(["Druvenlode"]);
    expect(parseWikilinkList(["[[Cobalt Soul]]", "[[Dwendalian Empire]]"])).toEqual([
      "Cobalt Soul",
      "Dwendalian Empire",
    ]);
    expect(parseWikilinkList(undefined)).toEqual([]);
  });

  it("accepts bare names in a string or an array", () => {
    expect(parseWikilinkList("Druvenlode")).toEqual(["Druvenlode"]);
    expect(parseWikilinkList(["Cobalt Soul", "[[Dwendalian Empire]]"])).toEqual([
      "Cobalt Soul",
      "Dwendalian Empire",
    ]);
  });

  it("returns targets only, dropping labels and headings", () => {
    expect(parseWikilinkList(["[[Rexxentrum|the capital]]", "[[Related#NPCs here]]"])).toEqual([
      "Rexxentrum",
      "Related",
    ]);
  });

  it("returns an empty array for null and an empty array", () => {
    expect(parseWikilinkList(null)).toEqual([]);
    expect(parseWikilinkList([])).toEqual([]);
  });

  it("returns an empty array for malformed frontmatter rather than throwing", () => {
    expect(parseWikilinkList(42)).toEqual([]);
    expect(parseWikilinkList(true)).toEqual([]);
    expect(parseWikilinkList({ a: "[[X]]" })).toEqual([]);
  });

  it("skips non-string and empty entries inside an array", () => {
    expect(parseWikilinkList(["[[A]]", 7, null, "", "[[]]", ["[[nested]]"], "[[B]]"])).toEqual([
      "A",
      "B",
    ]);
  });

  it("keeps non-ASCII targets intact", () => {
    expect(
      parseWikilinkList(["[[Caught in the Web — Children of Malice]]", "[[Hearth & Hammer]]"]),
    ).toEqual(["Caught in the Web — Children of Malice", "Hearth & Hammer"]);
  });
});

describe("buildLinkIndex", () => {
  const archive = note("D&D/Explorers of Exandria/Locations/Rexxentrum Archive of the Cobalt Soul.md");
  const bartlebee = note("D&D/Explorers of Exandria/NPCs/Bartlebee Aldermane.md", {
    aliases: ["Bartlebee"],
  });
  const arc = note("D&D/Explorers of Exandria/Arcs/Caught in the Web — Children of Malice.md");
  const dwendal = note("D&D/Explorers of Exandria/NPCs/Dwendal’s Gambit.md");
  const tavern = note("D&D/Explorers of Exandria/Locations/Hearth & Hammer.md");

  it("resolves by basename, case-insensitively", () => {
    const index = buildLinkIndex([archive, bartlebee]);
    expect(index.resolve("Rexxentrum Archive of the Cobalt Soul")).toBe(archive);
    expect(index.resolve("rexxentrum archive of the cobalt soul")).toBe(archive);
    expect(index.resolve("REXXENTRUM ARCHIVE OF THE COBALT SOUL")).toBe(archive);
  });

  it("resolves non-ASCII basenames", () => {
    const index = buildLinkIndex([arc, dwendal, tavern]);
    expect(index.resolve("Caught in the Web — Children of Malice")).toBe(arc);
    expect(index.resolve("caught in the web — children of malice")).toBe(arc);
    expect(index.resolve("Dwendal’s Gambit")).toBe(dwendal);
    expect(index.resolve("Hearth & Hammer")).toBe(tavern);
  });

  it("resolves by alias", () => {
    const index = buildLinkIndex([archive, bartlebee]);
    expect(index.resolve("Bartlebee")).toBe(bartlebee);
    expect(index.resolve("bartlebee")).toBe(bartlebee);
    expect(index.resolve("Bartlebee Aldermane")).toBe(bartlebee);
  });

  it("indexes every alias in the list, and accepts a single-string aliases value", () => {
    const multi = note("NPCs/Manner.md", { aliases: ["Mr. Manner", "The Quiet Man"] });
    const single = note("NPCs/Zerxus.md", { aliases: "Zerxus Ilerez" });
    const index = buildLinkIndex([multi, single]);
    expect(index.resolve("Mr. Manner")).toBe(multi);
    expect(index.resolve("the quiet man")).toBe(multi);
    expect(index.resolve("Zerxus Ilerez")).toBe(single);
  });

  it("ignores malformed aliases without throwing", () => {
    const odd = note("NPCs/Odd.md", { aliases: [7, null, "", "  ", { a: 1 }, "Fine"] });
    const none = note("NPCs/None.md", { aliases: 42 });
    const index = buildLinkIndex([odd, none]);
    expect(index.resolve("Fine")).toBe(odd);
    expect(index.resolve("Odd")).toBe(odd);
    expect(index.resolve("None")).toBe(none);
    expect(index.resolve("")).toBeUndefined();
  });

  it("returns undefined for an unknown target", () => {
    const index = buildLinkIndex([archive, bartlebee]);
    expect(index.resolve("Nowhere")).toBeUndefined();
    expect(index.resolve("")).toBeUndefined();
  });

  it("resolves nothing from an empty vault", () => {
    expect(buildLinkIndex([]).resolve("Anything")).toBeUndefined();
  });

  it("breaks a duplicate-basename tie by sorted path, deterministically", () => {
    const first = note("D&D/Explorers of Exandria/Locations/The Bone Pit.md");
    const second = note("D&D/Explorers of Exandria/Sessions/The Bone Pit.md");
    const a = buildLinkIndex([first, second]);
    const b = buildLinkIndex([second, first]);
    expect(a.resolve("The Bone Pit")).toBe(first);
    expect(b.resolve("The Bone Pit")).toBe(first);
    expect(a.resolve("the bone pit")).toBe(first);
  });

  it("gives the same answer for every ordering of a larger duplicate set", () => {
    const notes = [
      note("z/The Bone Pit.md"),
      note("m/The Bone Pit.md"),
      note("a/The Bone Pit.md"),
      note("b/the bone pit.md"),
    ];
    const orders = [
      notes,
      [...notes].reverse(),
      [notes[2], notes[0], notes[3], notes[1]],
      [notes[1], notes[3], notes[0], notes[2]],
    ];
    for (const order of orders) {
      expect(buildLinkIndex(order).resolve("The Bone Pit")?.path).toBe("a/The Bone Pit.md");
    }
  });

  it("does not reorder or mutate the notes it is given", () => {
    const input = [
      note("z/Dup.md", { aliases: ["Zed"] }),
      note("a/Dup.md"),
    ];
    const snapshot = input.map((n) => n.path);
    const dataBefore = JSON.stringify(input.map((n) => n.data));
    buildLinkIndex(input);
    expect(input.map((n) => n.path)).toEqual(snapshot);
    expect(JSON.stringify(input.map((n) => n.data))).toBe(dataBefore);
  });

  it("breaks an alias collision between two notes by sorted path, deterministically", () => {
    const early = note("a/Lady Nym.md", { aliases: ["Nym"] });
    const late = note("b/Nym the Younger.md", { aliases: ["Nym"] });
    expect(buildLinkIndex([early, late]).resolve("Nym")).toBe(early);
    expect(buildLinkIndex([late, early]).resolve("Nym")).toBe(early);
  });

  it("breaks a basename-versus-alias collision by sorted path, whichever claim it is", () => {
    // Both claim "Bartlebee": one as its basename, one as an alias.
    const aliasFirst = note("a/Bartlebee Aldermane.md", { aliases: ["Bartlebee"] });
    const basenameLater = note("b/Bartlebee.md");
    expect(buildLinkIndex([aliasFirst, basenameLater]).resolve("Bartlebee")).toBe(aliasFirst);
    expect(buildLinkIndex([basenameLater, aliasFirst]).resolve("Bartlebee")).toBe(aliasFirst);

    const basenameFirst = note("a/Bartlebee.md");
    const aliasLater = note("b/Bartlebee Aldermane.md", { aliases: ["Bartlebee"] });
    expect(buildLinkIndex([aliasLater, basenameFirst]).resolve("Bartlebee")).toBe(basenameFirst);
    expect(buildLinkIndex([basenameFirst, aliasLater]).resolve("Bartlebee")).toBe(basenameFirst);
  });

  it("indexes a note once under a key it claims twice", () => {
    const n = note("NPCs/Manner.md", { aliases: ["manner", "MANNER"] });
    expect(buildLinkIndex([n]).resolve("Manner")).toBe(n);
  });

  it("resolves a target ignoring surrounding whitespace", () => {
    expect(buildLinkIndex([archive]).resolve("  Rexxentrum Archive of the Cobalt Soul ")).toBe(
      archive,
    );
  });
});
