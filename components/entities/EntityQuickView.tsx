// components/entities/EntityQuickView.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowUpRight, Pencil, MapPin, Users, Package, Flag, type LucideIcon } from "lucide-react";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import {
  buildEntityQuickView,
  type EntityQuickViewModel,
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

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
    </div>
  );
}

function ErrorRow() {
  return <p className="py-4 text-sm text-destructive">Couldn&apos;t load this entity.</p>;
}

/** Fetches an entity's detail and builds the quick-view model (cancellation-guarded). */
export function useEntityQuickViewModel(resourcePath: EntityResourcePath, id: string) {
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

  const model = raw ? buildEntityQuickView(resourcePath, raw) : null;
  return { raw, model, loading, error };
}

/** Pure body sections (description / key props / related). Shared by the entity-page
 *  popover and the map slide-over. */
export function EntityQuickViewSections({ model }: { model: EntityQuickViewModel }) {
  return (
    <>
      {model.description && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/80 line-clamp-3">{model.description}</p>
      )}

      {model.props.length > 0 && (
        <div className="mt-3">
          <NotionPropsTable props={model.props} />
        </div>
      )}

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
    </>
  );
}

/** Body-only variant: fetch + loading/error + sections, no header/footer.
 *  Used by the map slide-over (which supplies its own marker header + footer). */
export function EntityQuickViewBody({ resourcePath, id }: { resourcePath: EntityResourcePath; id: string }) {
  const { model, loading, error } = useEntityQuickViewModel(resourcePath, id);
  if (loading) return <LoadingRow />;
  if (error || !model) return <ErrorRow />;
  return (
    <div className="text-sm">
      <EntityQuickViewSections model={model} />
    </div>
  );
}

interface EntityQuickViewProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
}

export function EntityQuickView({ resourcePath, id, onEdit }: EntityQuickViewProps) {
  const { raw, model, loading, error } = useEntityQuickViewModel(resourcePath, id);

  if (loading) return <LoadingRow />;
  if (error || !model || !raw) return <ErrorRow />;

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

      <EntityQuickViewSections model={model} />

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
            type="button"
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
