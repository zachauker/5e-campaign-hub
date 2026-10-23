import { describe, it, expect } from "vitest";
import { parseSourceProps } from "./props";

describe("parseSourceProps", () => {
  it("decodes a prop list", () => {
    const json = JSON.stringify([{ label: "Race", value: "Elf" }, { label: "Class", value: "Bard" }]);
    expect(parseSourceProps(json)).toEqual([{ label: "Race", value: "Elf" }, { label: "Class", value: "Bard" }]);
  });

  it("returns [] for null, undefined and an empty string", () => {
    expect(parseSourceProps(null)).toEqual([]);
    expect(parseSourceProps(undefined)).toEqual([]);
    expect(parseSourceProps("")).toEqual([]);
  });

  it("returns [] for malformed JSON or a non-array", () => {
    expect(parseSourceProps("{not json")).toEqual([]);
    expect(parseSourceProps('{"label":"a","value":"b"}')).toEqual([]);
  });

  it("drops entries that are not label/value strings", () => {
    const json = JSON.stringify([{ label: "Ok", value: "Yes" }, { label: "No" }, null, 3, { label: 1, value: "x" }]);
    expect(parseSourceProps(json)).toEqual([{ label: "Ok", value: "Yes" }]);
  });
});
