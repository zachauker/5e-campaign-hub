// components/entities/EntityQuickView.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowUpRight, Pencil, MapPin, Users, Package, Flag, type LucideIcon } from "lucide-react";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import {
  buildEntityQuickView,
  type EntityResourcePath,
  type EntityDetailResponse,
} from "@/components/entities/entity-quick-view-model";

const ENTITY_ICON: Record<EntityResourcePath, LucideIcon> = {
  characters: Users,
  locations: MapPin,
  items: Package,
  factions: Flag,
};

const ENTITY_ACCENT: Record<EntityResourcePath, string> = {
  characters: "var(--marker-character)",
  locations: "var(--marker-location)",
  items: "var(--marker-item)",
  factions: "var(--marker-faction)",
};

interface EntityQuickViewProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
}

export function EntityQuickView({ resourcePath, id, onEdit }: EntityQuickViewProps) {
  const [raw, setRaw] = useState<EntityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/${resourcePath}/${id}`);
        if (cancelled) return;
        if (res.ok) {
          setRaw((await res.json()) as EntityDetailResponse);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [resourcePath, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (error || !raw) {
    return <p className="py-4 text-sm text-destructive">Couldn&apos;t load this entity.</p>;
  }

  const model = buildEntityQuickView(resourcePath, raw);
  const Icon = ENTITY_ICON[resourcePath];
  const accent = ENTITY_ACCENT[resourcePath];

  return (
    <div className="text-sm">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <Icon className="w-5 h-5 flex-none mt-0.5" style={{ color: accent }} />
        <div className="min-w-0">
          <p className="font-medium text-[15px] leading-tight truncate">{model.name}</p>
          {model.typeLabel && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-0.5">{model.typeLabel}</p>
          )}
        </div>
      </div>

      {/* Description */}
      {model.description && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/80 line-clamp-3">{model.description}</p>
      )}

      {/* Key properties */}
      {model.props.length > 0 && (
        <div className="mt-3">
          <NotionPropsTable props={model.props} />
        </div>
      )}

      {/* Related */}
      {model.related.map((g) => (
        <div key={g.label} className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((it) => (
              <RelatedCard key={it.id} href={it.href} name={it.name} type={it.type ?? ""} />
            ))}
          </div>
        </div>
      ))}

      {/* Footer actions */}
      <div className="mt-3.5 flex items-center gap-2 border-t border-border pt-2.5">
        <Link
          href={model.fullHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open full page <ArrowUpRight className="w-3 h-3" />
        </Link>
        {onEdit && (
          <button
            onClick={() => onEdit(raw)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}
