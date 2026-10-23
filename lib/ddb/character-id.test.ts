import { describe, it, expect } from "vitest";
import { parseDdbCharacterId } from "./character-id";

describe("parseDdbCharacterId", () => {
  it("reads the long, profile and short link forms", () => {
    expect(parseDdbCharacterId("https://www.dndbeyond.com/characters/147707599")).toBe("147707599");
    expect(parseDdbCharacterId("https://www.dndbeyond.com/profile/zach/characters/87654321")).toBe("87654321");
    expect(parseDdbCharacterId("https://ddb.ac/characters/72922081/iHVVtz")).toBe("72922081");
  });

  it("accepts a bare numeric id", () => {
    expect(parseDdbCharacterId("12345678")).toBe("12345678");
    expect(parseDdbCharacterId(" 12345678 ")).toBe("12345678");
  });

  it("returns null for anything else", () => {
    expect(parseDdbCharacterId("https://example.com/sheet.pdf")).toBeNull();
    expect(parseDdbCharacterId("")).toBeNull();
    expect(parseDdbCharacterId(null)).toBeNull();
    expect(parseDdbCharacterId(undefined)).toBeNull();
  });
});
