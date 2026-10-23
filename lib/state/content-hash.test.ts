import { describe, it, expect } from "vitest";
import { hashContent } from "./content-hash";

describe("hashContent", () => {
  it("is stable for identical text", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });
  it("differs for different text", () => {
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
  it("ignores leading and trailing whitespace differences", () => {
    expect(hashContent("  abc\n")).toBe(hashContent("abc"));
  });
  it("returns a hex digest", () => {
    expect(hashContent("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
