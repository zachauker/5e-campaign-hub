"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords, Users, MapPin, Package, Shield, Command, Settings, Map, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { useUIStore } from "@/lib/store/ui-store";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Campaign } from "@/lib/db/schema";

const SECTIONS = [
  { href: "/encounters", label: "Encounters", icon: Swords },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/items", label: "Items", icon: Package },
  { href: "/factions", label: "Factions", icon: Shield },
  { href: "/world", label: "World", icon: Globe },
  { href: "/maps", label: "Maps", icon: Map },
];

export function TopBar() {
  const pathname = usePathname();
  const { activeCampaignId, setActiveCampaignId } = useCampaignStore();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const encounterStatus = useEncounterStore((s) => s.encounter?.status);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Combat focus mode: while running a live encounter, the hub nav is dead
  // weight competing with the initiative list. Collapse it to a thin strip that
  // reveals on hover / keyboard focus, giving those pixels back to the fight.
  const inCombat =
    (pathname?.startsWith("/encounters/") ?? false) && encounterStatus === "active";

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

  function handleCampaignChange(value: string) {
    if (value === "__new__") {
      setNewName("");
      setNewOpen(true);
      return;
    }
    setActiveCampaignId(value);
  }

  async function createCampaign() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const campaign: Campaign = await res.json();
      setCampaigns((prev) => [campaign, ...prev]);
      setActiveCampaignId(campaign.id);
      setNewOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const newCampaignDialog = (
    <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Campaign name"
          aria-label="Campaign name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createCampaign()}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => setNewOpen(false)}>
            Cancel
          </Button>
          <Button onClick={createCampaign} disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const bar = (
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
          aria-label="Active campaign"
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
  );

  if (!inCombat) {
    return (
      <>
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40 flex-none">
          {bar}
        </header>
        {newCampaignDialog}
      </>
    );
  }

  // Collapsed: a thin gold hairline reserves only ~6px; the full bar slides down
  // as an overlay on hover / focus-within, so revealing it never reflows the
  // combat list beneath. Keyboard users reach it by tabbing (focus-within).
  return (
    <header className="sticky top-0 z-40 flex-none group">
      <div
        className="h-1.5 bg-[var(--initiative)]/40 group-hover:opacity-0 group-focus-within:opacity-0 transition-opacity duration-200 motion-reduce:transition-none"
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-x-0 top-0 border-b border-border bg-card backdrop-blur-sm shadow-lg",
          "-translate-y-full opacity-0 pointer-events-none",
          "group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto",
          "group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
          "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
        )}
      >
        {bar}
      </div>
      {newCampaignDialog}
    </header>
  );
}
