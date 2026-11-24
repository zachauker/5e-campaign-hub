import { describe, it, expect } from "vitest";
import { portraitUrl } from "@/lib/library/portrait";
import type { CharacterUploadSchema } from "@/lib/character-schema";

const base: CharacterUploadSchema = { name: "Ogre", type: "monster", ac: 11, hpMax: 59 };
const withRemote: CharacterUploadSchema = {
  ...base,
  statBlock: { imageUrl: "https://example.com/ogre.png" },
};

describe("portraitUrl", () => {
  it("prefers an uploaded portrait", () => {
    expect(portraitUrl({ id: "lib-1", imagePath: "lib-1.png", data: withRemote })).toBe(
      "/api/library/lib-1/image"
    );
  });

  it("falls back to the sheet's remote imageUrl", () => {
    expect(portraitUrl({ id: "lib-1", imagePath: null, data: withRemote })).toBe(
      "https://example.com/ogre.png"
    );
  });

  it("falls back to avatarUrl when the sheet has no imageUrl", () => {
    expect(
      portraitUrl({ id: "lib-1", imagePath: null, data: { ...base, avatarUrl: "https://example.com/a.png" } })
    ).toBe("https://example.com/a.png");
  });

  it("returns null when there is neither", () => {
    expect(portraitUrl({ id: "lib-1", imagePath: null, data: base })).toBeNull();
  });

  it("returns null for an entry whose sheet and upload are both gone", () => {
    expect(portraitUrl({ id: "lib-1", imagePath: null, data: { ...base, statBlock: undefined } })).toBeNull();
  });
});
