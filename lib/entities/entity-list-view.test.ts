// lib/entities/entity-list-view.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeRow,
  deriveFilterFields,
  applyFilters,
  sortItems,
  FIELD_TYPE,
  SORT_NAME,
  type EntityListItem,
  type TypeConfig,
} from "./entity-list-view";

const TYPE_CFG: TypeConfig = {
  label: "Type",
  options: [
    { value: "city", label: "City" },
    { value: "town", label: "Town" },
  ],
};

function row(over: Record<string, unknown>) {
  return { id: "x", name: "X", description: null, type: null, notionProps: null, ...over };
}

describe("normalizeRow", () => {
  it("parses notionProps JSON into props", () => {
    const item = normalizeRow(row({ id: "a", name: "Emon", type: "city", notionProps: JSON.stringify([{ label: "Region", value: "Tal'Dorei" }]) }));
    expect(item).toEqual({ id: "a", name: "Emon", description: null, type: "city", props: [{ label: "Region", value: "Tal'Dorei" }] });
  });
  it("treats null/malformed notionProps as empty props", () => {
    expect(normalizeRow(row({ notionProps: null })).props).toEqual([]);
    expect(normalizeRow(row({ notionProps: "not json" })).props).toEqual([]);
  });
});

const ITEMS: EntityListItem[] = [
  { id: "1", name: "Emon", description: "Capital", type: "city", props: [{ label: "Region", value: "Tal'Dorei" }, { label: "Status", value: "Active" }] },
  { id: "2", name: "Alfield", description: null, type: "town", props: [{ label: "Region", value: "Tal'Dorei" }] },
  { id: "3", name: "Vasselheim", description: null, type: "city", props: [{ label: "Region", value: "Issylra" }] },
];

describe("deriveFilterFields", () => {
  it("includes a Type field (from config) plus property labels with distinct values", () => {
    const fields = deriveFilterFields(ITEMS, TYPE_CFG);
    const type = fields.find((f) => f.key === FIELD_TYPE)!;
    expect(type.label).toBe("Type");
    expect(type.values.map((v) => v.value).sort()).toEqual(["city", "town"]);
    expect(type.values.find((v) => v.value === "city")!.label).toBe("City");
    const region = fields.find((f) => f.key === "Region")!;
    expect(region.values.map((v) => v.value).sort()).toEqual(["Issylra", "Tal'Dorei"]);
    expect(fields.find((f) => f.key === "Status")).toBeTruthy();
  });
  it("omits the Type field when there is no typeConfig", () => {
    expect(deriveFilterFields(ITEMS, null).find((f) => f.key === FIELD_TYPE)).toBeUndefined();
  });
  it("disambiguates a property label that collides with the type field's label", () => {
    const items: EntityListItem[] = [
      { id: "1", name: "Emon", description: null, type: "city", props: [{ label: "Type", value: "Metropolis" }] },
    ];
    const fields = deriveFilterFields(items, TYPE_CFG);
    // structured type field keeps label "Type"
    expect(fields.find((f) => f.key === FIELD_TYPE)!.label).toBe("Type");
    // the colliding Notion property keeps key "Type" but displays "Type (Notion)"
    const prop = fields.find((f) => f.key === "Type")!;
    expect(prop.label).toBe("Type (Notion)");
    expect(prop.values.map((v) => v.value)).toEqual(["Metropolis"]);
  });
});

describe("applyFilters", () => {
  it("filters by name query (case-insensitive)", () => {
    expect(applyFilters(ITEMS, { query: "va", filters: [] }).map((i) => i.id)).toEqual(["3"]);
  });
  it("filters by type field", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city"] }] }).map((i) => i.id).sort()).toEqual(["1", "3"]);
  });
  it("ORs multiple values within a field", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city", "town"] }] }).length).toBe(3);
  });
  it("ANDs across fields", () => {
    const out = applyFilters(ITEMS, { query: "", filters: [{ field: FIELD_TYPE, values: ["city"] }, { field: "Region", values: ["Tal'Dorei"] }] });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });
  it("excludes items missing the filtered property", () => {
    const out = applyFilters(ITEMS, { query: "", filters: [{ field: "Status", values: ["Active"] }] });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });
  it("returns all with no query and no filters", () => {
    expect(applyFilters(ITEMS, { query: "", filters: [] }).length).toBe(3);
  });
});

describe("sortItems", () => {
  it("sorts by name asc/desc case-insensitively", () => {
    expect(sortItems(ITEMS, { key: SORT_NAME, dir: "asc" }).map((i) => i.name)).toEqual(["Alfield", "Emon", "Vasselheim"]);
    expect(sortItems(ITEMS, { key: SORT_NAME, dir: "desc" }).map((i) => i.name)).toEqual(["Vasselheim", "Emon", "Alfield"]);
  });
  it("sorts by a property, missing-key items last", () => {
    const items: EntityListItem[] = [
      { id: "a", name: "A", description: null, type: null, props: [{ label: "Region", value: "Zephrah" }] },
      { id: "b", name: "B", description: null, type: null, props: [] },
      { id: "c", name: "C", description: null, type: null, props: [{ label: "Region", value: "Emon" }] },
    ];
    expect(sortItems(items, { key: "Region", dir: "asc" }).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by type field", () => {
    expect(sortItems(ITEMS, { key: FIELD_TYPE, dir: "asc" }).map((i) => i.type)[0]).toBe("city");
  });
  it("does not mutate the input", () => {
    const copy = [...ITEMS];
    sortItems(ITEMS, { key: SORT_NAME, dir: "desc" });
    expect(ITEMS).toEqual(copy);
  });
});
