"use client";

import React, { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResolvedMarker } from "@/components/maps/map-types";
import { deriveLayerGroups } from "@/components/maps/marker-layers";

interface MarkerLayerControlProps {
  markers: ResolvedMarker[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}

// A checkbox whose "indeterminate" visual is set imperatively (native inputs
// can't take it as a prop).
function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />;
}

export function MarkerLayerControl({ markers, hidden, onChange }: MarkerLayerControlProps) {
  const [open, setOpen] = useState(false);
  const groups = deriveLayerGroups(markers);

  if (groups.length === 0) return null;

  function setKeys(keys: string[], hide: boolean) {
    const next = new Set(hidden);
    for (const k of keys) {
      if (hide) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  }

  return (
    <div className="relative">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen((v) => !v)}>
        <Layers className="w-3.5 h-3.5" /> Layers
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-border bg-card p-2 shadow-xl z-[1100] space-y-1">
          {groups.map((g) => {
            const leafKeys = g.leaves.length > 0 ? g.leaves.map((l) => l.key) : [g.key];
            const visibleLeaves = leafKeys.filter((k) => !hidden.has(k));
            const allOn = visibleLeaves.length === leafKeys.length;
            const someOn = visibleLeaves.length > 0;
            return (
              <div key={g.key}>
                <label className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer">
                  <TriStateCheckbox
                    checked={allOn}
                    indeterminate={someOn && !allOn}
                    onChange={() => setKeys(leafKeys, allOn)}
                  />
                  <span className="flex-1 font-medium">{g.label}</span>
                  <span className="text-xs text-muted-foreground">{g.count}</span>
                </label>
                {g.leaves.map((l) => (
                  <label key={l.key} className="flex items-center gap-2 pl-6 pr-1 py-0.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hidden.has(l.key)}
                      onChange={() => setKeys([l.key], !hidden.has(l.key))}
                      className="accent-primary"
                    />
                    <span className="flex-1 text-muted-foreground">{l.label}</span>
                    <span className="text-xs text-muted-foreground">{l.count}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
