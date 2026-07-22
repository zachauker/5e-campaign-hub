// components/entities/views/EntityTable.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight, ArrowUp, ArrowDown } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import { FIELD_TYPE, SORT_NAME, type EntityListItem, type TypeConfig, type SortState } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface EntityTableProps {
  items: EntityListItem[];
  resourcePath: "characters" | "locations" | "items" | "factions";
  singular: string;
  typeConfig: TypeConfig | null;
  columns: string[]; // property labels
  columnLabels: Record<string, string>;
  sort: SortState;
  onSort: (key: string) => void;
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function SortHeader({ label, sortKey, sort, onSort, className }: { label: string; sortKey: string; sort: SortState; onSort: (k: string) => void; className?: string }) {
  const active = sort.key === sortKey;
  return (
    <th className={`text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-3 py-2 ${className ?? ""}`}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

export function EntityTable({ items, resourcePath, singular, typeConfig, columns, columnLabels, sort, onSort, onEdit, onDelete }: EntityTableProps) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <SortHeader label="Name" sortKey={SORT_NAME} sort={sort} onSort={onSort} />
            {typeConfig && <SortHeader label={typeConfig.label} sortKey={FIELD_TYPE} sort={sort} onSort={onSort} />}
            {columns.map((c) => (
              <SortHeader key={c} label={columnLabels[c] ?? c} sortKey={c} sort={sort} onSort={onSort} />
            ))}
            <th className="px-3 py-2 w-px" />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const opt = typeConfig?.options.find((o) => o.value === e.type);
            return (
              <tr key={e.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 group">
                <td className="px-3 py-2">
                  <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
                    <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="text-left font-medium rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline">
                      {e.name}
                    </button>
                  </EntityQuickViewPopover>
                </td>
                {typeConfig && (
                  <td className="px-3 py-2">
                    {e.type && <Badge variant={(opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary"} className="capitalize">{opt?.label ?? e.type}</Badge>}
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 text-muted-foreground">{e.props.find((p) => p.label === c)?.value ?? "—"}</td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                      <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
