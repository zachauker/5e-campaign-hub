import { describe, it, expect } from "vitest";
import { omitLegacyColumns } from "./legacy-columns";

describe("omitLegacyColumns", () => {
  it("drops the notion_* fields and keeps everything else", () => {
    const row = {
      id: "a", name: "Emon", sourceProps: "[]", sourcePath: "x.md",
      notionUrl: "u", notionPageId: "p", notionProps: "[]", notionSyncedAt: new Date(),
    };
    expect(omitLegacyColumns(row)).toEqual({ id: "a", name: "Emon", sourceProps: "[]", sourcePath: "x.md" });
  });

  it("does not mutate its input", () => {
    const row = { id: "a", notionUrl: "u" };
    omitLegacyColumns(row);
    expect(row).toEqual({ id: "a", notionUrl: "u" });
  });
});
