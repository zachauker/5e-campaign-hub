import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttachmentPathError } from "./attachments";
import { VaultUnreadableError } from "./config";
import { FrontmatterError } from "./frontmatter";
import { digestBody } from "./body";
import { hashContent } from "@/lib/state/content-hash";
import { readNoteBody, readNoteForReview, readNoteText, reviewSourceFailure } from "./note-text";
import { VaultPathError } from "./paths";
import { mapNote } from "./map";
import { scanVault } from "./scan";
import { createTestVault } from "./test-helpers";

describe("readNoteText", () => {
  const originalVaultPath = process.env.VAULT_PATH;

  beforeEach(() => {
    delete process.env.VAULT_PATH;
  });

  afterEach(() => {
    if (originalVaultPath === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = originalVaultPath;
  });

  const useVault = (files: Record<string, string>): string => {
    const root = createTestVault(files);
    process.env.VAULT_PATH = root;
    return root;
  };

  it("returns the note's stripped plain text", async () => {
    useVault({
      "Sessions/Session 12.md":
        "---\ntype: session\nsession_number: 12\n---\n# The Archive\n\nThe party **found** a [[Bartlebee]] in the vault.\n",
    });
    const text = await readNoteText("Sessions/Session 12.md");
    expect(text).toContain("The Archive");
    expect(text).toContain("The party found a Bartlebee in the vault.");
    expect(text).not.toContain("**");
    expect(text).not.toContain("[[");
    // Frontmatter is metadata, not narrative: the model must not read it as prose.
    expect(text).not.toContain("session_number");
  });

  it("excludes [!dm] content, as the search index does", async () => {
    useVault({
      "Sessions/Session 13.md": [
        "The party reached the lighthouse.",
        "",
        "> [!dm] Tactics",
        "> The keeper is secretly Omari's brother.",
        "> She flees at half health.",
        "lazy continuation line with the vault key location",
        "",
        "> [!note] Table talk",
        "> Ordinary callouts keep their content.",
        "",
        "> [!DM]- Folded secret",
        "> The cult meets on the third moon.",
        "",
        "They rested for the night.",
        "",
      ].join("\n"),
    });
    const text = await readNoteText("Sessions/Session 13.md");
    expect(text).toContain("The party reached the lighthouse.");
    expect(text).toContain("They rested for the night.");
    expect(text).toContain("Ordinary callouts keep their content.");
    for (const secret of [
      "Tactics",
      "secretly Omari's brother",
      "flees at half health",
      "vault key location",
      "Folded secret",
      "third moon",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("excludes a [!dm] callout that nests inside another callout", async () => {
    useVault({
      "Sessions/Session 14.md": "> [!note] Recap\n> The party won.\n>\n> > [!dm] Hidden\n> > The duke is a lich.\n",
    });
    const text = await readNoteText("Sessions/Session 14.md");
    expect(text).toContain("The party won.");
    expect(text).not.toContain("duke is a lich");
  });

  it("throws VaultUnreadableError for a missing file", async () => {
    useVault({ "Sessions/Other.md": "x" });
    await expect(readNoteText("Sessions/Gone.md")).rejects.toBeInstanceOf(VaultUnreadableError);
  });

  it("throws VaultUnreadableError when the vault mount itself is missing", async () => {
    process.env.VAULT_PATH = path.join(os.tmpdir(), "hub-vault-does-not-exist-" + Date.now());
    await expect(readNoteText("Sessions/Session 12.md")).rejects.toBeInstanceOf(VaultUnreadableError);
  });

  it("throws VaultUnreadableError when the path names a directory", async () => {
    useVault({ "Sessions/Session 12.md": "x" });
    await expect(readNoteText("Sessions")).rejects.toBeInstanceOf(VaultUnreadableError);
  });

  it("rejects a path that escapes the vault", async () => {
    const root = useVault({ "Sessions/Session 12.md": "x" });
    fs.writeFileSync(path.join(path.dirname(root), "outside-secret.md"), "outside", "utf8");
    await expect(readNoteText("../outside-secret.md")).rejects.toBeInstanceOf(VaultPathError);
    await expect(readNoteText("Sessions/../../outside-secret.md")).rejects.toBeInstanceOf(VaultPathError);
    await expect(readNoteText(path.join(path.dirname(root), "outside-secret.md"))).rejects.toBeInstanceOf(
      VaultPathError,
    );
    fs.rmSync(path.join(path.dirname(root), "outside-secret.md"));
  });

  it("rejects a note that is a symlink resolving outside the vault", async () => {
    const root = useVault({ "Sessions/Session 12.md": "x" });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hub-outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "outside text", "utf8");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "Sessions", "Link.md"));
    await expect(readNoteText("Sessions/Link.md")).rejects.toBeInstanceOf(AttachmentPathError);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("returns an empty string for a frontmatter-only note", async () => {
    useVault({ "Sessions/Empty.md": "---\ntype: session\nsession_number: 1\n---\n" });
    expect(await readNoteText("Sessions/Empty.md")).toBe("");
  });

  it("returns an empty string for a note whose only content is a [!dm] callout", async () => {
    useVault({ "Sessions/Secret.md": "> [!dm]\n> Everything here is behind the screen.\n" });
    expect((await readNoteText("Sessions/Secret.md")).trim()).toBe("");
  });

  it("propagates malformed frontmatter as a FrontmatterError", async () => {
    useVault({ "Sessions/Bad.md": "---\nkey: [unclosed\n---\nbody\n" });
    await expect(readNoteText("Sessions/Bad.md")).rejects.toBeInstanceOf(FrontmatterError);
  });
});

describe("readNoteBody", () => {
  const originalVaultPath = process.env.VAULT_PATH;
  afterEach(() => {
    if (originalVaultPath === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = originalVaultPath;
  });

  const NOTE = [
    "---",
    "type: npc",
    "---",
    "Garrick keeps a mask on his belt.",
    "",
    "> [!dm] Behind the screen",
    "> He informs for the Assembly.",
    "",
  ].join("\n");

  it("returns the raw body, [!dm] callouts included, with frontmatter removed", async () => {
    process.env.VAULT_PATH = createTestVault({ "NPCs/Garrick.md": NOTE });
    const body = await readNoteBody("NPCs/Garrick.md");
    expect(body).toContain("Garrick keeps a mask on his belt.");
    expect(body).toContain("[!dm] Behind the screen");
    expect(body).toContain("He informs for the Assembly.");
    expect(body).not.toContain("type: npc");
  });

  it("is the text readNoteText strips, so the two cannot drift apart", async () => {
    process.env.VAULT_PATH = createTestVault({ "NPCs/Garrick.md": NOTE });
    expect(await readNoteText("NPCs/Garrick.md")).not.toContain("informs for the Assembly");
    expect(await readNoteBody("NPCs/Garrick.md")).toContain("informs for the Assembly");
  });

  it("digests to the source_hash the sync stores for the same file", async () => {
    const root = createTestVault({ "NPCs/Garrick.md": NOTE });
    process.env.VAULT_PATH = root;
    // A briefing is stale when source_hash moves. The builder reads the body from
    // disk but hashes from the row, so the two must describe the same bytes.
    const scanned = scanVault(root, root).notes[0];
    const stored = mapNote(scanned, "characters").sourceHash;
    expect(digestBody(await readNoteBody("NPCs/Garrick.md")).hash).toBe(stored);
  });

  it("throws VaultUnreadableError for a missing file", async () => {
    process.env.VAULT_PATH = createTestVault({});
    await expect(readNoteBody("NPCs/Nope.md")).rejects.toBeInstanceOf(VaultUnreadableError);
  });

  it("rejects a path that escapes the vault", async () => {
    process.env.VAULT_PATH = createTestVault({});
    await expect(readNoteBody("../outside.md")).rejects.toBeInstanceOf(VaultPathError);
  });
});

describe("readNoteForReview", () => {
  const originalVaultPath = process.env.VAULT_PATH;
  afterEach(() => {
    if (originalVaultPath === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = originalVaultPath;
  });

  it("hashes exactly the text it returns", async () => {
    process.env.VAULT_PATH = createTestVault({ "Sessions/S1.md": "---\ntype: session\n---\nThey fought a wolf.\n" });
    const { text, hash } = await readNoteForReview("Sessions/S1.md");
    expect(text).toBe(await readNoteText("Sessions/S1.md"));
    expect(hash).toBe(hashContent(text));
  });

  it("does not change when only a [!dm] callout is edited", async () => {
    process.env.VAULT_PATH = createTestVault({
      "Sessions/A.md": "They fought a wolf.\n\n> [!dm] Plan\n> It is a werewolf.\n",
      "Sessions/B.md": "They fought a wolf.\n\n> [!dm] Plan\n> It is a plain wolf.\n",
    });
    expect((await readNoteForReview("Sessions/A.md")).hash).toBe((await readNoteForReview("Sessions/B.md")).hash);
  });
});

describe("reviewSourceFailure", () => {
  it("maps an unreadable vault to 503", () => {
    const f = reviewSourceFailure(new VaultUnreadableError("gone"));
    expect(f?.status).toBe(503);
    expect(f?.message).toContain("gone");
  });

  it("maps a bad stored path to 400", () => {
    expect(reviewSourceFailure(new VaultPathError("nope"))?.status).toBe(400);
    expect(reviewSourceFailure(new AttachmentPathError("nope"))?.status).toBe(400);
  });

  it("maps malformed frontmatter to 400", () => {
    expect(reviewSourceFailure(new FrontmatterError("bad yaml"))?.status).toBe(400);
  });

  it("does not claim an unknown error", () => {
    expect(reviewSourceFailure(new Error("boom"))).toBeNull();
  });
});
