// components/entities/EntityListView.tsx
"use client";

import React, { useMemo, useState, useSyncExternalStore } from "react";
import { EntityListToolbar } from "@/components/entities/EntityListToolbar";
import { EntityListRows, type EntityViewProps } from "@/components/entities/views/EntityListRows";
import { EntityCardGrid } from "@/components/entities/views/EntityCardGrid";
import { EntityTable } from "@/components/entities/views/EntityTable";
import { readEntityView, writeEntityView } from "@/components/entities/entity-view-store";
import {
  normalizeRow,
  deriveFilterFields,
  applyFilters,
  sortItems,
  FIELD_TYPE,
  SORT_NAME,
  type RawEntityRow,
  type TypeConfig,
  type EntityView,
  type ActiveFilter,
  type SortState,
} from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

// react-hooks/set-state-in-effect (a React Compiler ESLint diagnostic) flags any
// direct setState call inside a useEffect body, even a legitimate "read the
// persisted view choice once we're on the client" sync — its own message
// points at useSyncExternalStore for exactly this "force update / external
// sync" case, so that's what we use here instead of an effect + setState.
// getServerSnapshot always returns the SSR-safe default ("list") so hydration
// matches the server-rendered HTML; React re-syncs to the real localStorage
// value right after hydration completes, with no manual effect required.
const viewListeners = new Set<() => void>();

function subscribeEntityView(callback: () => void): () => void {
  viewListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    viewListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function notifyEntityViewChange(): void {
  for (const listener of viewListeners) listener();
}

function getServerEntityView(): EntityView {
  return "list";
}

interface EntityListViewProps {
  resourcePath: EntityViewProps["resourcePath"];
  label: string;
  singular: string;
  accent: string;
  typeConfig: TypeConfig | null;
  items: RawEntityRow[];
  emptyHint: string; // e.g. "No locations yet."
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export function EntityListView(props: EntityListViewProps) {
  const { resourcePath, label, singular, accent, typeConfig, items: rawItems, emptyHint, onEdit, onDelete } = props;

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [sort, setSort] = useState<SortState>({ key: SORT_NAME, dir: "asc" });
  const [columns, setColumns] = useState<string[] | null>(null); // null = default

  // Subscribe to the persisted view choice via useSyncExternalStore rather than
  // reading localStorage during render or seeding it via an effect + setState:
  // getServerSnapshot returns the SSR-safe default ("list") so the first client
  // render matches the server-rendered HTML, and React re-syncs to the real
  // localStorage value right after hydration with no manual effect involved.
  const view = useSyncExternalStore(
    subscribeEntityView,
    () => readEntityView(resourcePath),
    getServerEntityView,
  );
  const setView = (v: EntityView) => {
    writeEntityView(resourcePath, v);
    notifyEntityViewChange();
  };

  const items = useMemo(() => rawItems.map(normalizeRow), [rawItems]);
  const fields = useMemo(() => deriveFilterFields(items, typeConfig), [items, typeConfig]);
  const visible = useMemo(() => sortItems(applyFilters(items, { query, filters }), sort), [items, query, filters, sort]);

  const propertyLabels = fields.filter((f) => f.key !== FIELD_TYPE).map((f) => f.key);
  const activeColumns = columns ?? propertyLabels.slice(0, 3);
  const columnLabels = Object.fromEntries(fields.map((f) => [f.key, f.label]));

  function toggleFilterValue(field: string, value: string) {
    setFilters((prev) => {
      const existing = prev.find((f) => f.field === field);
      if (!existing) return [...prev, { field, values: [value] }];
      const values = existing.values.includes(value) ? existing.values.filter((v) => v !== value) : [...existing.values, value];
      return prev.map((f) => (f.field === field ? { ...f, values } : f)).filter((f) => f.values.length > 0);
    });
  }
  function clearField(field: string) {
    setFilters((prev) => prev.filter((f) => f.field !== field));
  }
  function handleSort(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  function toggleColumn(label: string) {
    setColumns((prev) => {
      const base = prev ?? propertyLabels.slice(0, 3);
      return base.includes(label) ? base.filter((c) => c !== label) : [...base, label];
    });
  }

  const viewProps: EntityViewProps = { items: visible, resourcePath, singular, accent, typeConfig, onEdit, onDelete };

  return (
    <>
      <EntityListToolbar
        label={label}
        query={query}
        onQuery={setQuery}
        fields={fields}
        filters={filters}
        onToggleFilterValue={toggleFilterValue}
        onClearField={clearField}
        sort={sort}
        onSort={handleSort}
        view={view}
        onView={setView}
        columns={activeColumns}
        onToggleColumn={toggleColumn}
      />

      {visible.length === 0 ? (
        <div className="mt-6 text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground">
          {items.length === 0 ? emptyHint : "Nothing matches those filters."}
        </div>
      ) : view === "gallery" ? (
        <EntityCardGrid {...viewProps} />
      ) : view === "table" ? (
        <EntityTable items={visible} resourcePath={resourcePath} singular={singular} typeConfig={typeConfig} columns={activeColumns} columnLabels={columnLabels} sort={sort} onSort={handleSort} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <EntityListRows {...viewProps} />
      )}
    </>
  );
}
