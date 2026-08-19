import { describe, it, expect } from "vitest";
import { toFtsQuery } from "./fts";

describe("toFtsQuery", () => {
  it("turns a single word into a quoted prefix term", () => {
    expect(toFtsQuery("garr")).toBe('"garr"*');
  });

  it("ANDs multiple words, each a prefix term", () => {
    expect(toFtsQuery("mask guy")).toBe('"mask"* AND "guy"*');
  });

  it("strips FTS operators rather than passing them through", () => {
    expect(toFtsQuery('mask" OR guy')).toBe('"mask"* AND "or"* AND "guy"*');
  });

  it("keeps digits and drops punctuation", () => {
    expect(toFtsQuery("session #29!")).toBe('"session"* AND "29"*');
  });

  it("returns null for a query with no usable characters", () => {
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery("***")).toBeNull();
  });
});
