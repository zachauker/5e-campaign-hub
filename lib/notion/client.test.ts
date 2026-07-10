import { describe, it, expect } from "vitest";
import { extractNotionDatabaseId } from "./client";

describe("extractNotionDatabaseId", () => {
  it("pulls the 32-hex id from a database url", () => {
    expect(extractNotionDatabaseId("https://app.notion.com/p/06ab5086a1cf422ebb944a789a3bed2b?pvs=1"))
      .toBe("06ab5086a1cf422ebb944a789a3bed2b");
  });
  it("returns null when there is no id", () => {
    expect(extractNotionDatabaseId("https://example.com")).toBeNull();
  });
});
