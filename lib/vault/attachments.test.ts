import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  ALLOWED_IMAGE_EXT,
  AttachmentPathError,
  AttachmentWidthError,
  MAX_ATTACHMENT_WIDTH,
  MAX_CONCURRENT_RESIZES,
  MIN_ATTACHMENT_WIDTH,
  assertInsideVault,
  locateAttachment,
  parseWidth,
  renderResized,
  resolveAttachment,
} from "./attachments";
import { createTestVault } from "./test-helpers";

// Every temp dir a test makes is registered here and removed afterwards, so a
// failing assertion does not leave fixtures (or symlinks) behind.
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function vault(files: Record<string, string>): string {
  const root = createTestVault(files);
  tmpDirs.push(root);
  return root;
}

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-attach-"));
  tmpDirs.push(dir);
  return dir;
}

/** A real PNG of the given width, so sharp has something to decode. */
async function png(width: number, height = 10): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}

describe("ALLOWED_IMAGE_EXT", () => {
  it("is exactly the six image types the hub serves", () => {
    expect([...ALLOWED_IMAGE_EXT].sort()).toEqual([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
  });
});

describe("resolveAttachment", () => {
  it("finds an attachment by basename and returns its absolute real path", () => {
    const root = vault({ "Bartlebee_GeneratedArt.png": "x" });
    expect(resolveAttachment(root, "Bartlebee_GeneratedArt.png")).toBe(
      fs.realpathSync(path.join(root, "Bartlebee_GeneratedArt.png")),
    );
  });

  it("finds one nested under _Attachments", () => {
    const root = vault({ "_Attachments/Bartlebee_GeneratedArt.png": "x" });
    expect(resolveAttachment(root, "Bartlebee_GeneratedArt.png")).toBe(
      fs.realpathSync(path.join(root, "_Attachments", "Bartlebee_GeneratedArt.png")),
    );
  });

  it("finds an attachment stored under a different campaign folder than the note", () => {
    const root = vault({ "Other Campaign/art/Map.webp": "x", "D&D/Notes/a.md": "# a" });
    expect(resolveAttachment(root, "Map.webp")).toBe(fs.realpathSync(path.join(root, "Other Campaign/art/Map.webp")));
  });

  it("returns null for a missing file", () => {
    const root = vault({ "_Attachments/a.png": "x" });
    expect(resolveAttachment(root, "nope.png")).toBeNull();
  });

  it("returns null when the vault root itself does not exist", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveAttachment(path.join(tmpDir(), "gone"), "a.png")).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("returns null for a disallowed extension even when the file exists", () => {
    const root = vault({ "notes.md": "# n", "script.sh": "echo hi", "_Attachments/data.json": "{}", "noext": "x" });
    expect(resolveAttachment(root, "notes.md")).toBeNull();
    expect(resolveAttachment(root, "script.sh")).toBeNull();
    expect(resolveAttachment(root, "data.json")).toBeNull();
    expect(resolveAttachment(root, "noext")).toBeNull();
  });

  it("returns null for an empty or NUL-containing target", () => {
    const root = vault({ "a.png": "x" });
    expect(resolveAttachment(root, "")).toBeNull();
    expect(resolveAttachment(root, ".png")).toBeNull();
    expect(resolveAttachment(root, "a.png\0.md")).toBeNull();
  });

  it("handles a basename with spaces, parentheses and non-ASCII characters", () => {
    const root = vault({ "_Attachments/Shale (Lins).png": "x", "_Attachments/Líns — Ærie ✦.jpg": "x" });
    expect(resolveAttachment(root, "Shale (Lins).png")).toBe(
      fs.realpathSync(path.join(root, "_Attachments", "Shale (Lins).png")),
    );
    expect(resolveAttachment(root, "Líns — Ærie ✦.jpg")).not.toBeNull();
  });

  it("matches across Unicode normalisation forms (macOS NFD file, NFC link)", () => {
    const nfd = "Café.png";
    const nfc = "Café.png";
    const root = vault({ [`_Attachments/${nfd}`]: "x" });
    expect(resolveAttachment(root, nfc)).not.toBeNull();
  });

  it("matches the extension and basename case-insensitively, as Obsidian does on a Mac", () => {
    const root = vault({ "_Attachments/Photo.PNG": "x" });
    expect(resolveAttachment(root, "photo.png")).toBe(fs.realpathSync(path.join(root, "_Attachments", "Photo.PNG")));
  });

  it("uses only the last path segment of a target like folder/img.png", () => {
    const root = vault({ "_Attachments/img.png": "x" });
    expect(resolveAttachment(root, "some/where/img.png")).not.toBeNull();
    expect(resolveAttachment(root, "..\\..\\img.png")).not.toBeNull();
  });

  it("cannot be steered out of the vault by a traversal target", () => {
    const outer = tmpDir();
    fs.writeFileSync(path.join(outer, "secret.png"), "top secret");
    const root = path.join(outer, "vault");
    fs.mkdirSync(root);
    expect(resolveAttachment(root, "../secret.png")).toBeNull();
    expect(resolveAttachment(root, path.join(outer, "secret.png"))).toBeNull();
  });

  describe("duplicate basenames", () => {
    it("prefers the shallowest copy, as Obsidian does", () => {
      const root = vault({ "a/b/c/Dup.png": "deep", "z/Dup.png": "shallow", "m/n/Dup.png": "mid" });
      expect(resolveAttachment(root, "Dup.png")).toBe(fs.realpathSync(path.join(root, "z/Dup.png")));
    });

    it("breaks a depth tie by vault-relative path order, regardless of creation order", () => {
      const root = vault({ "zeta/Dup.png": "1", "alpha/Dup.png": "2", "mid/Dup.png": "3" });
      expect(resolveAttachment(root, "Dup.png")).toBe(fs.realpathSync(path.join(root, "alpha/Dup.png")));
    });

    it("prefers an exact-case match over a case-insensitive one", () => {
      const root = vault({ "a/Dup.png": "wrong case", "b/c/dup.png": "right case" });
      expect(resolveAttachment(root, "dup.png")).toBe(fs.realpathSync(path.join(root, "b/c/dup.png")));
    });
  });

  describe("excluded locations", () => {
    it("skips dot-directories, where the pre-migration backups live", () => {
      const root = vault({ "D&D/.backup-2026/Hero.png": "stale copy" });
      expect(resolveAttachment(root, "Hero.png")).toBeNull();
    });

    it("prefers the live copy over a backup copy that would sort or nest shallower", () => {
      const root = vault({ ".bak/Hero.png": "stale", "_Attachments/deep/er/Hero.png": "live" });
      expect(resolveAttachment(root, "Hero.png")).toBe(fs.realpathSync(path.join(root, "_Attachments/deep/er/Hero.png")));
    });

    it("skips _Templates", () => {
      const root = vault({ "_Templates/Placeholder.png": "x" });
      expect(resolveAttachment(root, "Placeholder.png")).toBeNull();
    });

    it("skips dot-files such as AppleDouble sidecars", () => {
      const root = vault({ "_Attachments/._Hero.png": "resource fork" });
      expect(resolveAttachment(root, "._Hero.png")).toBeNull();
    });

    it("warns, and keeps searching, when a directory cannot be read", () => {
      if (process.getuid?.() === 0) return; // root ignores mode bits
      const root = vault({ "open/Found.png": "x", "locked/inner.png": "x" });
      fs.chmodSync(path.join(root, "locked"), 0o000);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(resolveAttachment(root, "Found.png")).not.toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("locked"));
      } finally {
        warn.mockRestore();
        fs.chmodSync(path.join(root, "locked"), 0o755);
      }
    });

    it("does not descend into a symlinked directory", () => {
      const outer = tmpDir();
      const elsewhere = path.join(outer, "elsewhere");
      fs.mkdirSync(elsewhere);
      fs.writeFileSync(path.join(elsewhere, "Via.png"), "x");
      const root = path.join(outer, "vault");
      fs.mkdirSync(root);
      fs.symlinkSync(elsewhere, path.join(root, "linked"));
      expect(resolveAttachment(root, "Via.png")).toBeNull();
    });
  });
});

describe("assertInsideVault", () => {
  it("accepts a path inside the vault", () => {
    const root = vault({ "_Attachments/ok.png": "x" });
    expect(() => assertInsideVault(root, path.join(root, "_Attachments/ok.png"))).not.toThrow();
  });

  it("rejects a parent-traversal path", () => {
    const outer = tmpDir();
    fs.writeFileSync(path.join(outer, "secret.png"), "top secret");
    const root = path.join(outer, "vault");
    fs.mkdirSync(root);
    expect(() => assertInsideVault(root, path.join(root, "../secret.png"))).toThrow(AttachmentPathError);
  });

  it("rejects a symlink pointing outside the vault", () => {
    // A real file outside the vault, reached through a symlink that sits at a
    // perfectly in-vault path. A string-prefix check sees "<root>/_Attachments/
    // evil.png", which starts with the root, and waves it through.
    const outer = tmpDir();
    const secret = path.join(outer, "outside-secret.png");
    fs.writeFileSync(secret, "not in the vault");
    const root = path.join(outer, "vault");
    fs.mkdirSync(path.join(root, "_Attachments"), { recursive: true });
    const evil = path.join(root, "_Attachments", "evil.png");
    fs.symlinkSync(secret, evil);

    expect(evil.startsWith(root)).toBe(true); // what a prefix check would see
    expect(fs.readFileSync(evil, "utf8")).toBe("not in the vault"); // and it really escapes
    expect(() => assertInsideVault(root, evil)).toThrow(AttachmentPathError);
  });

  it("rejects a file reached through a symlinked directory that points outside", () => {
    const outer = tmpDir();
    const elsewhere = path.join(outer, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "x.png"), "x");
    const root = path.join(outer, "vault");
    fs.mkdirSync(root);
    fs.symlinkSync(elsewhere, path.join(root, "linked"));
    expect(() => assertInsideVault(root, path.join(root, "linked", "x.png"))).toThrow(AttachmentPathError);
  });

  it("accepts a symlink that stays inside the vault", () => {
    const root = vault({ "real/a.png": "x" });
    fs.symlinkSync(path.join(root, "real/a.png"), path.join(root, "alias.png"));
    expect(() => assertInsideVault(root, path.join(root, "alias.png"))).not.toThrow();
  });

  it("rejects an absolute path elsewhere on disk", () => {
    const root = vault({ "a.png": "x" });
    const other = tmpDir();
    fs.writeFileSync(path.join(other, "b.png"), "x");
    expect(() => assertInsideVault(root, path.join(other, "b.png"))).toThrow(AttachmentPathError);
    expect(() => assertInsideVault(root, "/etc/hosts")).toThrow(AttachmentPathError);
  });

  it("rejects a sibling directory whose name merely starts with the vault's name", () => {
    const outer = tmpDir();
    const root = path.join(outer, "vault");
    const sibling = path.join(outer, "vault-evil");
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "a.png"), "x");
    expect(() => assertInsideVault(root, path.join(sibling, "a.png"))).toThrow(AttachmentPathError);
  });

  it("accepts a file whose name merely begins with two dots (called directly; the resolver never yields one)", () => {
    const root = vault({ "..weird.png": "x" });
    expect(() => assertInsideVault(root, path.join(root, "..weird.png"))).not.toThrow();
  });

  it("rejects the vault root itself", () => {
    const root = vault({ "a.png": "x" });
    expect(() => assertInsideVault(root, root)).toThrow(AttachmentPathError);
  });

  it("fails closed when the path does not exist", () => {
    const root = vault({ "a.png": "x" });
    expect(() => assertInsideVault(root, path.join(root, "missing.png"))).toThrow(AttachmentPathError);
  });

  it("fails closed when the vault root does not exist", () => {
    const outer = tmpDir();
    fs.writeFileSync(path.join(outer, "a.png"), "x");
    expect(() => assertInsideVault(path.join(outer, "gone"), path.join(outer, "a.png"))).toThrow(AttachmentPathError);
  });

  it("accepts a vault root that is itself reached through a symlink", () => {
    // Both sides are realpath'd, so this must not be a false rejection. The
    // real vault lives in one place and is mounted at another via a symlink,
    // which is what /tmp -> /private/tmp does to every macOS fixture.
    const outer = tmpDir();
    const real = path.join(outer, "real-vault");
    fs.mkdirSync(path.join(real, "_Attachments"), { recursive: true });
    fs.writeFileSync(path.join(real, "_Attachments", "ok.png"), "x");
    const linked = path.join(outer, "mount");
    fs.symlinkSync(real, linked);

    // Given via the link...
    expect(() => assertInsideVault(linked, path.join(linked, "_Attachments", "ok.png"))).not.toThrow();
    // ...and mixed: one side already resolved, the other not.
    expect(() => assertInsideVault(linked, path.join(real, "_Attachments", "ok.png"))).not.toThrow();
    expect(() => assertInsideVault(real, path.join(linked, "_Attachments", "ok.png"))).not.toThrow();
  });

  it("the symlinked-root case also holds end to end through the resolver", () => {
    const outer = tmpDir();
    const real = path.join(outer, "real-vault");
    fs.mkdirSync(path.join(real, "_Attachments"), { recursive: true });
    fs.writeFileSync(path.join(real, "_Attachments", "ok.png"), "x");
    const linked = path.join(outer, "mount");
    fs.symlinkSync(real, linked);

    const found = resolveAttachment(linked, "ok.png");
    expect(found).not.toBeNull();
    expect(() => assertInsideVault(linked, found!)).not.toThrow();
    expect(locateAttachment(linked, "ok.png")?.path).toBe(found);
  });
});

describe("locateAttachment", () => {
  it("returns the real path and a content type for a legitimate attachment", () => {
    const root = vault({ "_Attachments/a.PNG": "x", "_Attachments/b.jpg": "x", "_Attachments/c.svg": "<svg/>" });
    expect(locateAttachment(root, "a.png")?.contentType).toBe("image/png");
    expect(locateAttachment(root, "b.jpg")?.contentType).toBe("image/jpeg");
    expect(locateAttachment(root, "c.svg")?.contentType).toBe("image/svg+xml");
  });

  it("returns null for a missing attachment", () => {
    expect(locateAttachment(vault({ "a.png": "x" }), "nope.png")).toBeNull();
  });

  it("returns null for an in-vault symlink whose name is an image but whose real file is not", () => {
    // `x.png -> Notes/secret.md` is genuinely inside the vault, so containment
    // passes; the content-type lookup on the post-realpath extension is the
    // only thing that stops a note being served as image/png.
    const root = vault({ "Notes/secret.md": "# not an image", "Notes/data.json": "{}" });
    fs.mkdirSync(path.join(root, "_Attachments"));
    fs.symlinkSync(path.join(root, "Notes/secret.md"), path.join(root, "_Attachments/x.png"));
    fs.symlinkSync(path.join(root, "Notes/data.json"), path.join(root, "_Attachments/y.svg"));

    expect(resolveAttachment(root, "x.png")).toBe(fs.realpathSync(path.join(root, "Notes/secret.md")));
    expect(() => assertInsideVault(root, resolveAttachment(root, "x.png")!)).not.toThrow();
    expect(locateAttachment(root, "x.png")).toBeNull();
    expect(locateAttachment(root, "y.svg")).toBeNull();
  });

  it("throws AttachmentPathError when the only match is a symlink out of the vault", () => {
    const outer = tmpDir();
    const secret = path.join(outer, "secret.png");
    fs.writeFileSync(secret, "outside");
    const root = path.join(outer, "vault");
    fs.mkdirSync(path.join(root, "_Attachments"), { recursive: true });
    fs.symlinkSync(secret, path.join(root, "_Attachments", "evil.png"));
    expect(() => locateAttachment(root, "evil.png")).toThrow(AttachmentPathError);
  });
});

describe("parseWidth", () => {
  it("returns null when no width is requested", () => {
    expect(parseWidth(null)).toBeNull();
    expect(parseWidth("")).toBeNull();
  });

  it("returns a valid width unchanged", () => {
    expect(parseWidth("640")).toBe(640);
  });

  it("clamps an oversized width to the maximum and a tiny one to the minimum", () => {
    expect(parseWidth("99999999")).toBe(MAX_ATTACHMENT_WIDTH);
    expect(parseWidth("1")).toBe(MIN_ATTACHMENT_WIDTH);
    expect(MIN_ATTACHMENT_WIDTH).toBe(16);
  });

  it("rejects values that are not a plain positive integer", () => {
    for (const bad of ["abc", "-5", "0", "12.5", "1e9", "0x10", "10px", " 10"]) {
      expect(() => parseWidth(bad), bad).toThrow(AttachmentWidthError);
    }
  });
});

describe("renderResized", () => {
  it("downsizes a wide raster to the requested width", async () => {
    const root = vault({});
    fs.writeFileSync(path.join(root, "wide.png"), await png(1200));
    const out = await renderResized(path.join(root, "wide.png"), 300);
    expect((await sharp(out).metadata()).width).toBe(300);
    expect((await sharp(out).metadata()).format).toBe("png");
  });

  it("resizes an animated gif without losing its format", async () => {
    const root = vault({});
    const gif = await sharp({ create: { width: 400, height: 10, channels: 3, background: "#123456" } }).gif().toBuffer();
    fs.writeFileSync(path.join(root, "a.gif"), gif);
    const out = await renderResized(path.join(root, "a.gif"), 100);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("gif");
    expect(meta.width).toBe(100);
  });

  it("refuses a source larger than the input pixel limit", async () => {
    const root = vault({});
    fs.writeFileSync(path.join(root, "big.png"), await png(300, 300)); // 90,000 px
    await expect(renderResized(path.join(root, "big.png"), 100, 10_000)).rejects.toThrow(/pixel/i);
    await expect(renderResized(path.join(root, "big.png"), 100, 90_000)).resolves.toBeInstanceOf(Buffer);
  });

  it("completes many simultaneous resizes while holding to the concurrency bound", async () => {
    const root = vault({});
    fs.writeFileSync(path.join(root, "a.png"), await png(800));
    const jobs = Array.from({ length: MAX_CONCURRENT_RESIZES * 4 }, () => renderResized(path.join(root, "a.png"), 100));
    const outs = await Promise.all(jobs);
    expect(outs).toHaveLength(MAX_CONCURRENT_RESIZES * 4);
    for (const out of outs) expect((await sharp(out).metadata()).width).toBe(100);
  });

  it("a failed resize releases its slot", async () => {
    const root = vault({ "bad.png": "not a png" });
    const bad = Array.from({ length: MAX_CONCURRENT_RESIZES * 2 }, () =>
      renderResized(path.join(root, "bad.png"), 100).catch(() => "failed"),
    );
    expect(await Promise.all(bad)).toEqual(Array(MAX_CONCURRENT_RESIZES * 2).fill("failed"));
    fs.writeFileSync(path.join(root, "ok.png"), await png(300));
    await expect(renderResized(path.join(root, "ok.png"), 100)).resolves.toBeInstanceOf(Buffer);
  });

  it("never upscales past the source width", async () => {
    const root = vault({});
    fs.writeFileSync(path.join(root, "small.png"), await png(100));
    const out = await renderResized(path.join(root, "small.png"), 2000);
    expect((await sharp(out).metadata()).width).toBe(100);
  });

  it("keeps a source larger than the clamp within the clamp", async () => {
    const root = vault({});
    fs.writeFileSync(path.join(root, "huge.png"), await png(MAX_ATTACHMENT_WIDTH + 500, 4));
    const out = await renderResized(path.join(root, "huge.png"), parseWidth("99999999")!);
    expect((await sharp(out).metadata()).width).toBe(MAX_ATTACHMENT_WIDTH);
  });
});
