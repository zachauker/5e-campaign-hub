"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Swords, Users, MapPin, Package, Shield, ArrowRight } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { cn, formatDate } from "@/lib/utils";
import type { Encounter } from "@/lib/db/schema";

export default function DashboardPage() {
  const { activeCampaignId } = useCampaignStore();
  const [recentEncounters, setRecentEncounters] = useState<Encounter[]>([]);
  const [counts, setCounts] = useState({ characters: 0, locations: 0, items: 0, factions: 0 });
  const [campaignName, setCampaignName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/encounters")
      .then((r) => r.json())
      .then((data: Encounter[]) => setRecentEncounters(data.slice(0, 5)))
      .catch(() => {
        // Recent-encounters list is optional context on the dashboard; leave it empty on failure.
      });
  }, []);

  useEffect(() => {
    if (!activeCampaignId) return;
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((cs: { id: string; name: string }[]) =>
        setCampaignName(cs.find((c) => c.id === activeCampaignId)?.name ?? null)
      )
      .catch(() => {
        // Falls back to a generic hero title.
      });
    Promise.all([
      fetch(`/api/characters?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/locations?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/items?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/factions?campaignId=${activeCampaignId}`).then((r) => r.json()),
    ])
      .then(([c, l, i, f]) =>
        setCounts({ characters: c.items.length, locations: l.length, items: i.items.length, factions: f.items.length })
      )
      .catch(() => {
        // Section counts are supplementary; leave them at their default (0) on failure.
      });
  }, [activeCampaignId]);

  const activeEncounter = recentEncounters.find((e) => e.status === "active");

  const stats = [
    { href: "/characters", label: "Characters", icon: Users, count: counts.characters, color: "var(--marker-character)" },
    { href: "/locations", label: "Locations", icon: MapPin, count: counts.locations, color: "var(--marker-location)" },
    { href: "/items", label: "Items", icon: Package, count: counts.items, color: "var(--marker-item)" },
    { href: "/factions", label: "Factions", icon: Shield, count: counts.factions, color: "var(--marker-faction)" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Hero */}
      <section>
        <p className="font-display italic text-lg text-[var(--initiative)]">Your campaign</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[1.03] mt-1 text-balance">
          {campaignName ?? "Campaign Hub"}
        </h1>
      </section>

      {/* The one thing that matters most: a fight in progress */}
      {activeEncounter && (
        <Link
          href={`/encounters/${activeEncounter.id}`}
          className="group mt-8 flex items-center gap-4 rounded-xl border border-primary/50 bg-primary/10 px-5 py-4 hover:bg-primary/15 transition-colors"
        >
          <div className="w-11 h-11 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center flex-none">
            <Swords className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Battle underway
            </p>
            <p className="font-medium truncate">Resume {activeEncounter.name}</p>
            <p className="text-xs text-muted-foreground">Round {activeEncounter.round}</p>
          </div>
          <ArrowRight className="w-5 h-5 text-primary flex-none transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {/* The world by the numbers — the count is the hero, not a card */}
      <div className="mt-10 flex flex-wrap gap-x-10 gap-y-6">
        {stats.map((s) => (
          <Link key={s.href} href={s.href} className="group flex items-baseline gap-2.5">
            <span
              className="font-display text-4xl leading-none tabular-nums"
              style={{ color: s.color }}
            >
              {s.count}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              <s.icon className="w-3.5 h-3.5" /> {s.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Recent encounters */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-border pb-2">
          <h2 className="font-display text-2xl">Recent encounters</h2>
          <Link href="/encounters" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>

        {recentEncounters.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No encounters yet.{" "}
            <Link href="/encounters" className="text-primary hover:underline">
              Start one →
            </Link>
          </p>
        ) : (
          <div className="mt-2 divide-y divide-border/60">
            {recentEncounters.map((enc) => (
              <Link
                key={enc.id}
                href={`/encounters/${enc.id}`}
                className="flex items-center gap-3 px-2 py-3 -mx-2 rounded-md hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Swords
                  className={cn(
                    "w-4 h-4 flex-none",
                    enc.status === "active" ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className="flex-1 min-w-0 text-[15px] font-medium truncate">{enc.name}</span>
                <span className="text-xs text-muted-foreground flex-none">
                  {formatDate(new Date(enc.updatedAt))}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
