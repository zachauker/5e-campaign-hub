// lib/entities/entity-list-view.ts

export type EntityView = "list" | "gallery" | "table";

/** Sentinel keys so a Notion property literally named "Type"/"Name" can't collide
 *  with the structured type field or the name sort. */
export const FIELD_TYPE = "__type__";
export const SORT_NAME = "__name__";

export interface EntityProp {
  label: string;
  value: string;
}

export interface EntityListItem {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  props: EntityProp[];
}

export interface TypeOption {
  value: string;
  label: string;
  badgeVariant?: string;
}

export interface TypeConfig {
  label: string;
  options: TypeOption[];
}

export interface FilterFieldValue {
  value: string;
  label: string;
}

export interface FilterField {
  key: string; // FIELD_TYPE or a property label
  label: string;
  values: FilterFieldValue[];
}

export interface ActiveFilter {
  field: string; // FIELD_TYPE or a property label
  values: string[]; // OR-ed
}

export interface SortState {
  key: string; // SORT_NAME, FIELD_TYPE, or a property label
  dir: "asc" | "desc";
}

/** A raw list row from GET /api/{resourcePath} (a superset of these fields). */
export interface RawEntityRow {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  notionProps?: string | null;
}

export function normalizeRow(row: RawEntityRow): EntityListItem {
  let props: EntityProp[] = [];
  if (row.notionProps) {
    try {
      const parsed = JSON.parse(row.notionProps);
      if (Array.isArray(parsed)) {
        props = parsed.filter(
          (p): p is EntityProp => p && typeof p.label === "string" && typeof p.value === "string",
        );
      }
    } catch {
      props = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    type: row.type ?? null,
    props,
  };
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function deriveFilterFields(items: EntityListItem[], typeConfig: TypeConfig | null): FilterField[] {
  const fields: FilterField[] = [];

  if (typeConfig) {
    const present = distinct(items.map((i) => i.type).filter((t): t is string => !!t));
    if (present.length > 0) {
      fields.push({
        key: FIELD_TYPE,
        label: typeConfig.label,
        values: present.map((v) => ({
          value: v,
          label: typeConfig.options.find((o) => o.value === v)?.label ?? v,
        })),
      });
    }
  }

  // Property labels in first-seen order, each with its distinct values.
  const labelOrder: string[] = [];
  const byLabel = new Map<string, Set<string>>();
  for (const item of items) {
    for (const p of item.props) {
      if (!byLabel.has(p.label)) {
        byLabel.set(p.label, new Set());
        labelOrder.push(p.label);
      }
      byLabel.get(p.label)!.add(p.value);
    }
  }
  const typeLabel = typeConfig?.label;
  for (const label of labelOrder) {
    fields.push({
      key: label,
      label: label === typeLabel ? `${label} (Notion)` : label,
      values: distinct([...byLabel.get(label)!]).map((v) => ({ value: v, label: v })),
    });
  }

  return fields;
}

function valueForField(item: EntityListItem, field: string): string | null {
  if (field === FIELD_TYPE) return item.type;
  return item.props.find((p) => p.label === field)?.value ?? null;
}

export function applyFilters(
  items: EntityListItem[],
  { query, filters }: { query: string; filters: ActiveFilter[] },
): EntityListItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    for (const f of filters) {
      if (f.values.length === 0) continue;
      const v = valueForField(item, f.field);
      if (v === null || !f.values.includes(v)) return false; // AND across fields, OR within
    }
    return true;
  });
}

export function sortItems(items: EntityListItem[], sort: SortState): EntityListItem[] {
  const keyOf = (item: EntityListItem): string | null =>
    sort.key === SORT_NAME ? item.name : valueForField(item, sort.key);
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1; // missing keys always last
    if (kb === null) return -1;
    return factor * ka.localeCompare(kb, undefined, { sensitivity: "base" });
  });
}
