import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createTestVault } from "./test-helpers";
import { scanVault } from "./scan";
import { resolveCampaignFolder, VaultUnreadableError } from "./config";

const NOTE = "---\ntype: npc\n---\n# Body\n";

describe("scanVault", () => {
  it("returns one note per markdown file with a vault-relative path", () => {
    const vault = createTestVault({
      "camp/Locations/Blackvein Quarry.md": "---\ntype: location\n---\n# Quarry\n",
      "camp/NPCs/Manner.md": NOTE,
    });
    const { notes, warnings } = scanVault(path.join(vault, "camp"), vault);
    expect(warnings).toEqual([]);
    expect(notes).toHaveLength(2);
    const quarry = notes.find((n) => n.basename === "Blackvein Quarry")!;
    expect(quarry.path).toBe("camp/Locations/Blackvein Quarry.md");
    expect(quarry.data.type).toBe("location");
    expect(quarry.body).toBe("# Quarry\n");
  });

  it("keeps the full vault-relative path when the campaign folder is nested (D&D/Campaign)", () => {
    const vault = createTestVault({ "D&D/Explorers of Exandria/NPCs/Manner.md": NOTE });
    const { notes } = scanVault(path.join(vault, "D&D", "Explorers of Exandria"), vault);
    expect(notes.map((n) => n.path)).toEqual(["D&D/Explorers of Exandria/NPCs/Manner.md"]);
  });

  it("excludes _Templates", () => {
    const vault = createTestVault({
      "camp/Real.md": NOTE,
      "camp/_Templates/Character.md": "---\ntype: pc\n---\n",
    });
    const { notes } = scanVault(path.join(vault, "camp"), vault);
    expect(notes.map((n) => n.basename)).toEqual(["Real"]);
  });

  it("excludes dot-directories", () => {
    const vault = createTestVault({
      "camp/Real.md": NOTE,
      "camp/.backup-2026/Old.md": NOTE,
      "camp/.notion-import/Stale.md": NOTE,
    });
    const { notes } = scanVault(path.join(vault, "camp"), vault);
    expect(notes.map((n) => n.basename)).toEqual(["Real"]);
  });

  it("excludes _Templates and dot-directories at any depth", () => {
    const vault = createTestVault({
      "camp/NPCs/Real.md": NOTE,
      "camp/NPCs/_Templates/Deep.md": NOTE,
      "camp/NPCs/Allies/.obsidian/Hidden.md": NOTE,
      "camp/NPCs/Allies/_Templates/Deeper.md": NOTE,
    });
    const { notes } = scanVault(path.join(vault, "camp"), vault);
    expect(notes.map((n) => n.basename)).toEqual(["Real"]);
  });

  it("ignores non-markdown files", () => {
    const vault = createTestVault({
      "camp/Real.md": NOTE,
      "camp/_Attachments/art.png": "not really a png",
      "camp/notes.txt": "text",
      "camp/Real.md.bak": NOTE,
    });
    const { notes } = scanVault(path.join(vault, "camp"), vault);
    expect(notes.map((n) => n.path)).toEqual(["camp/Real.md"]);
  });

  it("skips a note with malformed YAML and warns naming its path, but keeps scanning", () => {
    const vault = createTestVault({
      "camp/A/Broken.md": "---\ntype: [unclosed\n: :\n---\nbody\n",
      "camp/B/Fine.md": NOTE,
      "camp/C/AlsoFine.md": NOTE,
    });
    const result = scanVault(path.join(vault, "camp"), vault);
    expect(result.notes.map((n) => n.basename).sort()).toEqual(["AlsoFine", "Fine"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("camp/A/Broken.md");
  });

  it("treats a note with no frontmatter as valid", () => {
    const vault = createTestVault({ "camp/Plain.md": "# Plain\n\ntext\n" });
    const { notes, warnings } = scanVault(path.join(vault, "camp"), vault);
    expect(warnings).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0].data).toEqual({});
    expect(notes[0].body).toBe("# Plain\n\ntext\n");
  });

  it("preserves non-ASCII basenames exactly", () => {
    const names = [
      "Cobalt Soul Reunion — Beilar & Elbera",
      "Ilthara’s Ledger",
    ];
    const vault = createTestVault(
      Object.fromEntries(names.map((n) => [`D&D/camp/Sessions/${n}.md`, NOTE])),
    );
    const { notes } = scanVault(path.join(vault, "D&D", "camp"), vault);
    expect(notes.map((n) => n.basename).sort()).toEqual([...names].sort());
    for (const n of notes) {
      expect(n.path).toBe(`D&D/camp/Sessions/${n.basename}.md`);
      expect(fs.existsSync(path.join(vault, n.path))).toBe(true);
    }
  });

  it("defaults the vault root to VAULT_PATH when none is passed", () => {
    const vault = createTestVault({ "camp/Real.md": NOTE });
    vi.stubEnv("VAULT_PATH", vault);
    const { notes } = scanVault(path.join(vault, "camp"));
    expect(notes[0].path).toBe("camp/Real.md");
  });
});

describe("resolveCampaignFolder", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("joins VAULT_PATH with the relative root path", () => {
    const vault = createTestVault({ "D&D/Explorers of Exandria/NPCs/Manner.md": NOTE });
    vi.stubEnv("VAULT_PATH", vault);
    expect(resolveCampaignFolder("D&D/Explorers of Exandria")).toBe(
      path.join(vault, "D&D", "Explorers of Exandria"),
    );
  });

  it("defaults VAULT_PATH to /vault", () => {
    vi.stubEnv("VAULT_PATH", "");
    // /vault does not exist on a dev machine; the error message proves the default was used.
    expect(() => resolveCampaignFolder("nope")).toThrow(/\/vault/);
  });

  it("throws VaultUnreadableError for a missing directory", () => {
    const vault = createTestVault({ "camp/Real.md": NOTE });
    vi.stubEnv("VAULT_PATH", vault);
    expect(() => resolveCampaignFolder("missing")).toThrow(VaultUnreadableError);
  });

  it("throws VaultUnreadableError when the path is a file, not a directory", () => {
    const vault = createTestVault({ "camp/Real.md": NOTE });
    vi.stubEnv("VAULT_PATH", vault);
    expect(() => resolveCampaignFolder("camp/Real.md")).toThrow(VaultUnreadableError);
  });
});
