import { describe, it, expect } from "vitest";
import {
  VaultPathError,
  assertVaultRelative,
  attachmentUrl,
  embedItemHref,
  hubHref,
  obsidianUri,
  safeExternalHref,
  vaultPageUrl,
} from "./paths";

/** Real note paths from the vault: an em dash, a curly apostrophe, and `&`. */
const AWKWARD_PATHS = [
  "D&D/Scenes/Cobalt Soul Reunion — Beilar & Elbera.md",
  "D&D/Encounters/The Bone Pit — Tubi\u2019s First Bout.md",
  "Scenes/a=b&c=d?e#f%20g+h.md",
];

describe("obsidianUri", () => {
  it("builds a vault-and-file uri", () => {
    expect(obsidianUri("Willowbrook-Remote", "D&D/Sessions/Session 29.md"))
      .toBe("obsidian://open?vault=Willowbrook-Remote&file=D%26D%2FSessions%2FSession%2029.md");
  });

  it("encodes an ampersand in the path so the uri cannot be truncated", () => {
    const uri = obsidianUri("V", "Scenes/Cobalt Soul Reunion — Beilar & Elbera.md");
    expect(uri).toContain("%26");
    // The only literal & is the one between the two params.
    expect(uri.split("&")).toHaveLength(2);
  });

  it("encodes an em dash and a curly apostrophe", () => {
    const uri = obsidianUri("V", "Encounters/The Bone Pit — Tubi\u2019s First Bout.md");
    expect(uri).toContain("%E2%80%94");
    expect(uri).toContain("%E2%80%99");
  });

  it("round-trips: decoding the file param yields the original path", () => {
    const p = "Scenes/Cobalt Soul Reunion — Beilar & Elbera.md";
    const file = new URL(obsidianUri("V", p)).searchParams.get("file");
    expect(file).toBe(p);
  });

  it.each(AWKWARD_PATHS)("round-trips %s exactly, leaving vault intact", (p) => {
    const params = new URL(obsidianUri("My Vault", p)).searchParams;
    expect(params.get("file")).toBe(p);
    expect(params.get("vault")).toBe("My Vault");
  });

  it("encodes the vault name too", () => {
    const uri = obsidianUri("Willow & Brook — Remote", "Note.md");
    expect(uri).toContain("vault=Willow%20%26%20Brook%20%E2%80%94%20Remote");
    expect(new URL(uri).searchParams.get("vault")).toBe("Willow & Brook — Remote");
  });

  it("writes a space as %20, never +, which Obsidian would read as a literal plus", () => {
    const uri = obsidianUri("V", "A B+C.md");
    expect(uri).not.toContain("+");
    expect(uri).toContain("A%20B%2BC.md");
  });

  it("omits the vault param when no vault name is configured", () => {
    for (const unset of ["", "   "]) {
      const uri = obsidianUri(unset, "Notes/A & B.md");
      expect(uri).toBe("obsidian://open?file=Notes%2FA%20%26%20B.md");
      expect(new URL(uri).searchParams.has("vault")).toBe(false);
    }
  });
});

describe("vaultPageUrl", () => {
  it("targets the page route with the path as a query param", () => {
    expect(vaultPageUrl("Sessions/Session 29.md")).toBe("/api/vault/page?path=Sessions%2FSession%2029.md");
  });

  it.each(AWKWARD_PATHS)("round-trips %s through the query string", (p) => {
    const url = vaultPageUrl(p);
    // A request URL is parsed relative to an origin on the server.
    expect(new URL(url, "http://localhost").searchParams.get("path")).toBe(p);
  });

  it("does not let an ampersand in the path start a second param", () => {
    const parsed = new URL(vaultPageUrl("Beilar & Elbera.md"), "http://localhost");
    expect([...parsed.searchParams.keys()]).toEqual(["path"]);
  });
});

describe("attachmentUrl", () => {
  it("targets the attachment route", () => {
    expect(attachmentUrl("Art.png")).toBe("/api/vault/attachment?target=Art.png");
  });

  it("adds a width when asked", () => {
    const parsed = new URL(attachmentUrl("Art.png", 640), "http://localhost");
    expect(parsed.searchParams.get("target")).toBe("Art.png");
    expect(parsed.searchParams.get("w")).toBe("640");
  });

  it("round-trips a target with an ampersand and an apostrophe", () => {
    const t = "Tubi\u2019s Bout & After — Art.png";
    expect(new URL(attachmentUrl(t, 320), "http://localhost").searchParams.get("target")).toBe(t);
  });
});

describe("embedItemHref", () => {
  it("routes each kind to its detail page", () => {
    expect(embedItemHref("character", "c1")).toBe("/characters/c1");
    expect(embedItemHref("item", "i1")).toBe("/items/i1");
    expect(embedItemHref("location", "l1")).toBe("/locations/l1");
  });

  it("routes a session item, which also covers encounters and scenes, to the session-note page", () => {
    expect(embedItemHref("session", "s1")).toBe("/sessions/s1");
  });
});

describe("assertVaultRelative", () => {
  it("accepts a normal relative path", () => {
    expect(() => assertVaultRelative("D&D/Sessions/Session 29.md")).not.toThrow();
  });

  it("accepts the awkward real-vault paths", () => {
    for (const p of AWKWARD_PATHS) expect(() => assertVaultRelative(p)).not.toThrow();
  });

  it("rejects an absolute path", () => {
    expect(() => assertVaultRelative("/etc/passwd")).toThrow(VaultPathError);
    expect(() => assertVaultRelative("C:\\Windows\\win.ini")).toThrow(VaultPathError);
    expect(() => assertVaultRelative("\\\\server\\share\\x.md")).toThrow(VaultPathError);
  });

  it("rejects a path with a .. segment", () => {
    expect(() => assertVaultRelative("../secret.md")).toThrow(VaultPathError);
    expect(() => assertVaultRelative("Sessions/../../secret.md")).toThrow(VaultPathError);
    expect(() => assertVaultRelative("Sessions/..")).toThrow(VaultPathError);
  });

  it("rejects a .. hidden behind a backslash", () => {
    expect(() => assertVaultRelative("Sessions\\..\\..\\secret.md")).toThrow(VaultPathError);
  });

  it("accepts a path whose filename merely contains dots", () => {
    expect(() => assertVaultRelative("Notes/A.B. Notes.md")).not.toThrow();
    expect(() => assertVaultRelative("Notes/..hidden-ish.md")).not.toThrow();
    expect(() => assertVaultRelative("Notes/Wait... what.md")).not.toThrow();
  });

  it("rejects an empty path and a NUL byte", () => {
    expect(() => assertVaultRelative("")).toThrow(VaultPathError);
    expect(() => assertVaultRelative("Notes/a\0.md")).toThrow(VaultPathError);
  });

  it("throws an error that identifies itself", () => {
    try {
      assertVaultRelative("../x.md");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("VaultPathError");
    }
  });
});

describe("safeExternalHref", () => {
  it("passes web and mail links through", () => {
    expect(safeExternalHref("https://example.com/a?b=c&d=e")).toBe("https://example.com/a?b=c&d=e");
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
    expect(safeExternalHref("mailto:dm@example.com")).toBe("mailto:dm@example.com");
  });

  it("refuses script, data and relative targets", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("  JavaScript:alert(1)")).toBeNull();
    expect(safeExternalHref("data:text/html,<script>1</script>")).toBeNull();
    expect(safeExternalHref("/api/settings")).toBeNull();
    expect(safeExternalHref("Some Note.md")).toBeNull();
  });

  it("returns null for an empty or missing href", () => {
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});

describe("hubHref", () => {
  it("routes all five kinds, factions included", () => {
    expect(hubHref("character", "c")).toBe("/characters/c");
    expect(hubHref("location", "l")).toBe("/locations/l");
    expect(hubHref("item", "i")).toBe("/items/i");
    expect(hubHref("faction", "f")).toBe("/factions/f");
    expect(hubHref("session", "s")).toBe("/sessions/s");
  });
});
