import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { digestBody } from "./body";

describe("digestBody", () => {
  describe("hash", () => {
    it("returns a stable hash for identical input", () => {
      expect(digestBody("The room is cold.").hash).toBe(digestBody("The room is cold.").hash);
    });

    it("returns different hashes for different input", () => {
      expect(digestBody("The room is cold.").hash).not.toBe(digestBody("The room is warm.").hash);
    });

    it("is the sha256 hex digest of the raw markdown", () => {
      const md = "# Title\n\n> [!dm]\n> secret\n";
      expect(digestBody(md).hash).toBe(createHash("sha256").update(md, "utf8").digest("hex"));
    });

    it("is taken before stripping, so editing a [!dm] callout changes the hash but not the text", () => {
      const a = digestBody("The room is cold.\n\n> [!dm] Tactics\n> She targets Bartlebee.");
      const b = digestBody("The room is cold.\n\n> [!dm] Tactics\n> She targets Omari.");
      expect(a.text).toBe(b.text);
      expect(a.hash).not.toBe(b.hash);
    });

    it("returns an empty, hash-stable result for an empty body", () => {
      const r = digestBody("");
      expect(r.text).toBe("");
      expect(r.hash).toBe(digestBody("").hash);
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("[!dm] stripping", () => {
    it("strips a [!dm] callout entirely", () => {
      const text = digestBody("> [!dm] Tactics\n> She targets Bartlebee.\n\nThe room is cold.").text;
      expect(text).not.toContain("Bartlebee");
      expect(text).not.toContain("Tactics");
      expect(text).toContain("The room is cold");
    });

    it("strips a multi-line [!dm] callout with bold and list content", () => {
      const md = [
        "> [!dm] Tactics",
        "> **Her primary pivot point:** Omari and Bartlebee are Restrained.",
        "> - **If Bartlebee is within reach:** Move toward her.",
        "",
        "Visible.",
      ].join("\n");
      const text = digestBody(md).text;
      expect(text).not.toMatch(/pivot|Omari|Bartlebee|Restrained/);
      expect(text).toBe("Visible.");
    });

    it("strips a collapsed [!dm]- callout, including its embed", () => {
      const text = digestBody("> [!dm]- Factions\n> ![[Factions.base]]\n\nAfter.").text;
      expect(text).not.toContain("Factions");
      expect(text).toBe("After.");
    });

    it("strips an expanded-by-default [!dm]+ callout", () => {
      expect(digestBody("> [!dm]+ Secret\n> hidden\n\nshown").text).toBe("shown");
    });

    it("matches the callout type case-insensitively", () => {
      for (const marker of ["[!DM]", "[!Dm]", "[!DM]-", "[!dM]+"]) {
        const text = digestBody(`> ${marker} Title\n> hidden\n\nshown`).text;
        expect(text, marker).not.toContain("hidden");
        expect(text, marker).toBe("shown");
      }
    });

    it("strips a [!dm] block at the very start of the note", () => {
      expect(digestBody("> [!dm]\n> hidden\n\nshown").text).toBe("shown");
    });

    it("strips a [!dm] block at the very end with no trailing content or newline", () => {
      expect(digestBody("shown\n\n> [!dm]\n> hidden").text).toBe("shown");
      expect(digestBody("shown\n\n> [!dm]\n> hidden\n").text).toBe("shown");
      expect(digestBody("> [!dm]").text).toBe("");
    });

    it("strips a [!dm] block with no blank line before it", () => {
      expect(digestBody("shown\n> [!dm]\n> hidden").text).not.toContain("hidden");
    });

    it("strips two [!dm] blocks in one note and keeps what lies between them", () => {
      const md = "> [!dm]\n> first secret\n\nBetween.\n\n> [!dm]- Again\n> second secret\n\nEnd.";
      const text = digestBody(md).text;
      expect(text).not.toContain("secret");
      expect(text).toContain("Between.");
      expect(text).toContain("End.");
    });

    it("does not over-strip: a different callout after a blank line survives", () => {
      const md = "> [!dm]\n> hidden\n\n> [!read-aloud]\n> Morning in the common room.";
      const text = digestBody(md).text;
      expect(text).not.toContain("hidden");
      expect(text).toContain("Morning in the common room");
    });

    it("does not over-strip: prose directly after the blockquote survives", () => {
      expect(digestBody("> [!dm]\n> hidden\nstill prose?").text).toContain("still prose?");
    });

    it("strips a [!dm] callout that is nested inside another callout, but keeps the outer", () => {
      const md = "> [!note] Outer\n> Outer text.\n> > [!dm]\n> > hidden\n> More outer.";
      const text = digestBody(md).text;
      expect(text).not.toContain("hidden");
      expect(text).toContain("Outer text.");
      expect(text).toContain("More outer.");
    });

    it("does not treat other callout types that merely start with dm as DM-only", () => {
      const text = digestBody("> [!dmg-roll]\n> 2d6 fire.").text;
      expect(text).toContain("2d6 fire.");
    });

    it("tolerates CRLF line endings", () => {
      expect(digestBody("> [!dm]\r\n> hidden\r\n\r\nshown\r\n").text).toBe("shown");
    });

    it("keeps [!dm] mentioned in running prose", () => {
      expect(digestBody("Use the [!dm] callout for secrets.").text).toContain("callout for secrets");
    });
  });

  describe("other callouts", () => {
    it("keeps every other callout's content", () => {
      const text = digestBody("> [!read-aloud]\n> Morning in the common room.").text;
      expect(text).toContain("Morning in the common room");
    });

    it("keeps content and title for the other callout types in use", () => {
      for (const type of ["read-aloud", "describe", "check", "note", "warning"]) {
        const text = digestBody(`> [!${type}]- Heading here\n> Body of ${type}.`).text;
        expect(text, type).toContain("Heading here");
        expect(text, type).toContain(`Body of ${type}.`);
        expect(text, type).not.toContain("[!");
      }
    });
  });

  describe("markdown to plain text", () => {
    it("drops heading markers", () => {
      expect(digestBody("# Manner\n\n## Voice").text).toBe("Manner\nVoice");
    });

    it("drops emphasis markers", () => {
      const text = digestBody("**bold** and *italic* and ***both*** and ~~gone~~ and ==marked==").text;
      expect(text).toBe("bold and italic and both and gone and marked");
    });

    it("drops underscore emphasis but leaves snake_case alone", () => {
      expect(digestBody("__bold__ and _italic_ and snake_case_name").text).toBe(
        "bold and italic and snake_case_name",
      );
    });

    it("reduces wikilinks to their label, or their target when there is no label", () => {
      expect(digestBody("Visit [[Rexxentrum]] and [[Locations/Blackvein Quarry|the quarry]].").text).toBe(
        "Visit Rexxentrum and the quarry.",
      );
    });

    it("reduces a heading link to its target, and to its label when it has one", () => {
      expect(digestBody("[[Rexxentrum#History]] / [[Rexxentrum#History|the past]]").text).toBe(
        "Rexxentrum / the past",
      );
    });

    it("reduces markdown links to their text", () => {
      expect(digestBody("See [the wiki](https://example.com/page) now.").text).toBe("See the wiki now.");
    });

    it("drops image and note embeds entirely", () => {
      const text = digestBody("Before\n\n![[map.png]]\n\n![A map](images/map.png)\n\nAfter ![[Factions.base]] end").text;
      expect(text).not.toMatch(/map|png|Factions|\]|\[|!/);
      expect(text).toContain("Before");
      expect(text).toContain("After");
      expect(text).toContain("end");
    });

    it("strips list, task, quote and rule markers", () => {
      const md = "- one\n* two\n1. three\n- [ ] todo\n- [x] done\n> quoted\n\n---\n";
      expect(digestBody(md).text).toBe("one\ntwo\nthree\ntodo\ndone\nquoted");
    });

    it("keeps inline code content without the backticks and drops fence lines", () => {
      expect(digestBody("Roll `2d6+3` here.\n\n```\nraw block\n```").text).toBe("Roll 2d6+3 here.\nraw block");
    });

    it("turns table rows into spaced cells and drops the separator row", () => {
      const text = digestBody("| Name | DC |\n|------|----|\n| Lockpick | 15 |").text;
      expect(text).toBe("Name DC\nLockpick 15");
    });

    it("drops Obsidian and HTML comments, which are hidden in reading view", () => {
      const text = digestBody("Seen %%private note%% text <!-- hidden --> end\n\n%%\nmultiline\nsecret\n%%\n\nlast").text;
      expect(text).not.toMatch(/private|hidden|multiline|secret/);
      expect(text).toBe("Seen text end\nlast");
    });

    it("drops trailing block ids", () => {
      expect(digestBody("A paragraph. ^abc123").text).toBe("A paragraph.");
    });

    it("collapses whitespace and blank lines deterministically", () => {
      const a = digestBody("Line   one\n\n\n\n   Line two   \n").text;
      expect(a).toBe("Line one\nLine two");
      expect(digestBody("Line   one\n\n\n\n   Line two   \n").text).toBe(a);
    });
  });
});
