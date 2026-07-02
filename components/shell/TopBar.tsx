"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords, Users, MapPin, Package, Shield, Command, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useUIStore } from "@/lib/store/ui-store";
import type { Campaign } from "@/lib/db/schema";

const SECTIONS = [
  { href: "/encounters", label: "Encounters", icon: Swords },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/items", label: "Items", icon: Package },
  { href: "/factions", label: "Factions", icon: Shield },
];

export function TopBar() {
  const pathname = usePathname();
  const { activeCampaignId, setActiveCampaignId } = useCampaignStore();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    useCampaignStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: Campaign[]) => {
        setCampaigns(data);
        // Read the live store value instead of the closed-over `activeCampaignId`:
        // this effect and the rehydrate() effect above both resolve asynchronously,
        // so the closure value can still be stale (pre-rehydration) by the time this
        // fetch resolves, which would otherwise clobber a just-rehydrated selection.
        if (!useCampaignStore.getState().activeCampaignId && data.length > 0) {
          setActiveCampaignId(data[0].id);
        }
      });
    // Only run once on mount — activeCampaignId changes shouldn't refetch the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCampaignChange(value: string) {
    if (value === "__new__") {
      const name = window.prompt("Campaign name:");
      if (!name?.trim()) return;
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const campaign: Campaign = await res.json();
      setCampaigns((prev) => [campaign, ...prev]);
      setActiveCampaignId(campaign.id);
      return;
    }
    setActiveCampaignId(value);
  }

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40 flex-none">
      <div className="px-4 h-12 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm text-primary flex-none">
          <Swords className="w-4 h-4" /> HUB
        </Link>

        <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {SECTIONS.map((s) => {
            const active = pathname?.startsWith(s.href) ?? false;
            return (
              <Link
                key={s.href}
                href={s.href}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap",
                  active
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <s.icon className="w-3.5 h-3.5" /> {s.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground border border-border hover:border-primary/50 hover:text-foreground transition-colors flex-none"
        >
          <Command className="w-3 h-3" /> K
        </button>

        <select
          value={activeCampaignId ?? ""}
          onChange={(e) => handleCampaignChange(e.target.value)}
          className="text-xs bg-muted border border-border rounded-md px-2 py-1 max-w-[140px] flex-none"
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ New Campaign</option>
        </select>

        <Link
          href="/settings"
          aria-label="Settings"
          className="text-muted-foreground hover:text-foreground transition-colors flex-none"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}
