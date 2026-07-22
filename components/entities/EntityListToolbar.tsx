// components/entities/EntityListToolbar.tsx
"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { List, LayoutGrid, Table as TableIcon, Filter, ArrowUpDown, Columns3, X, Check } from "lucide-react";
import {
  FIELD_TYPE,
  SORT_NAME,
  type EntityView,
  type FilterField,
  type ActiveFilter,
  type SortState,
} from "@/lib/entities/entity-list-view";

interface EntityListToolbarProps {
  label: string;
  query: string;
  onQuery: (q: string) => void;
  fields: FilterField[];
  filters: ActiveFilter[];
  onToggleFilterValue: (field: string, value: string) => void;
  onClearField: (field: string) => void;
  sort: SortState;
  onSort: (key: string) => void; // toggles dir if same key
  view: EntityView;
  onView: (v: EntityView) => void;
  columns: string[];
  onToggleColumn: (label: string) => void;
}

const VIEWS: { view: EntityView; icon: typeof List; label: string }[] = [
  { view: "list", icon: List, label: "List" },
  { view: "gallery", icon: LayoutGrid, label: "Gallery" },
  { view: "table", icon: TableIcon, label: "Table" },
];

function fieldLabel(fields: FilterField[], key: string) {
  return fields.find((f) => f.key === key)?.label ?? key;
}
function valueLabel(fields: FilterField[], key: string, value: string) {
  return fields.find((f) => f.key === key)?.values.find((v) => v.value === value)?.label ?? value;
}

export function EntityListToolbar(props: EntityListToolbarProps) {
  const { label, query, onQuery, fields, filters, onToggleFilterValue, onClearField, sort, onSort, view, onView, columns, onToggleColumn } = props;
  const [openField, setOpenField] = useState<string | null>(null); // which field's values are shown in the add-filter popover
  const propertyFields = fields.filter((f) => f.key !== FIELD_TYPE);

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="flex-1 min-w-[12rem]" placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(e) => onQuery(e.target.value)} />

        {/* Add filter */}
        {fields.length > 0 && (
          <Popover onOpenChange={(o) => !o && setOpenField(null)}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5"><Filter className="w-3.5 h-3.5" /> Filter</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              {openField === null ? (
                <div className="max-h-72 overflow-y-auto">
                  <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Filter by</p>
                  {fields.map((f) => (
                    <button key={f.key} type="button" onClick={() => setOpenField(f.key)} className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent">{f.label}</button>
                  ))}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <button type="button" onClick={() => setOpenField(null)} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">← {fieldLabel(fields, openField)}</button>
                  {(fields.find((f) => f.key === openField)?.values ?? []).map((v) => {
                    const checked = filters.find((f) => f.field === openField)?.values.includes(v.value) ?? false;
                    return (
                      <button key={v.value} type="button" onClick={() => onToggleFilterValue(openField, v.value)} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                        <span className="w-3.5 h-3.5 flex-none">{checked && <Check className="w-3.5 h-3.5" />}</span>
                        <span className="truncate">{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Sort */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" /> Sort</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <div className="max-h-72 overflow-y-auto">
              <button type="button" onClick={() => onSort(SORT_NAME)} className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                Name {sort.key === SORT_NAME && <span className="text-xs text-muted-foreground">{sort.dir === "asc" ? "A→Z" : "Z→A"}</span>}
              </button>
              {fields.map((f) => (
                <button key={f.key} type="button" onClick={() => onSort(f.key)} className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                  {f.label} {sort.key === f.key && <span className="text-xs text-muted-foreground">{sort.dir === "asc" ? "↑" : "↓"}</span>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Columns (table only) */}
        {view === "table" && propertyFields.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5"><Columns3 className="w-3.5 h-3.5" /> Columns</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              <div className="max-h-72 overflow-y-auto">
                <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Property columns</p>
                {propertyFields.map((f) => {
                  const on = columns.includes(f.key);
                  return (
                    <button key={f.key} type="button" onClick={() => onToggleColumn(f.key)} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                      <span className="w-3.5 h-3.5 flex-none">{on && <Check className="w-3.5 h-3.5" />}</span>
                      <span className="truncate">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* View switcher */}
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {VIEWS.map(({ view: v, icon: Icon, label: l }) => (
            <button key={v} type="button" aria-label={`${l} view`} aria-pressed={view === v} onClick={() => onView(v)} className={`rounded-md p-1.5 ${view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Active filter chips */}
      {filters.some((f) => f.values.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.filter((f) => f.values.length > 0).map((f) => (
            <span key={f.field} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 pl-2.5 pr-1 py-0.5 text-xs">
              <span className="text-muted-foreground">{fieldLabel(fields, f.field)}:</span>
              <span className="font-medium">{f.values.map((v) => valueLabel(fields, f.field, v)).join(", ")}</span>
              <button type="button" aria-label={`Clear ${fieldLabel(fields, f.field)} filter`} onClick={() => onClearField(f.field)} className="rounded-full p-0.5 hover:bg-background">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
