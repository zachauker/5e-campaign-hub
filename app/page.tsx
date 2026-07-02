"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Swords, Users, MapPin, Package, Shield, PlayCircle } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { Encounter } from "@/lib/db/schema";

export default function DashboardPage() {
  const { activeCampaignId } = useCampaignStore();
  const [recentEncounters, setRecentEncounters] = useState<Encounter[]>([]);
  const [counts, setCounts] = useState({ characters: 0, locations: 0, items: 0, factions: 0 });

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
    Promise.all([
      fetch(`/api/characters?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/locations?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/items?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/factions?campaignId=${activeCampaignId}`).then((r) => r.json()),
    ])
      .then(([c, l, i, f]) =>
        setCounts({ characters: c.length, locations: l.length, items: i.length, factions: f.length })
      )
      .catch(() => {
        // Section counts are supplementary; leave them at their default (0) on failure.
      });
  }, [activeCampaignId]);

  const activeEncounter = recentEncounters.find((e) => e.status === "active");

  const cards = [
    { href: "/characters", label: "Characters", icon: Users, count: counts.characters },
    { href: "/locations", label: "Locations", icon: MapPin, count: counts.locations },
    { href: "/items", label: "Items", icon: Package, count: counts.items },
    { href: "/factions", label: "Factions", icon: Shield, count: counts.factions },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      {activeEncounter && (
        <Link
          href={`/encounters/${activeEncounter.id}`}
          className="flex items-center gap-3 p-4 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-colors"
        >
          <PlayCircle className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium text-sm">Active Encounter</p>
            <p className="text-xs text-muted-foreground">
              {activeEncounter.name} — Round {activeEncounter.round}
            </p>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <c.icon className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.count}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Recent Encounters</h2>
          <Link href="/encounters" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="space-y-2">
          {recentEncounters.map((enc) => (
            <Link
              key={enc.id}
              href={`/encounters/${enc.id}`}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors"
            >
              <Swords className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{enc.name}</span>
            </Link>
          ))}
          {recentEncounters.length === 0 && <p className="text-sm text-muted-foreground">No encounters yet.</p>}
        </div>
      </div>
    </div>
  );
}
