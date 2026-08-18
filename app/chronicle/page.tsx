"use client";

import { useEffect, useState } from "react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { ChronicleBrowser } from "@/components/state/ChronicleBrowser";

export default function ChroniclePage() {
  // The active campaign comes from the persisted campaign store, exactly as the
  // other hub pages resolve it (SimpleEntityManager, SessionNotesBrowser) — not
  // from a query param, so no useSearchParams and no Suspense boundary here.
  const activeCampaignId = useCampaignStore((s) => s.activeCampaignId);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // The store is persisted with skipHydration, so on a cold load of /chronicle
    // the id arrives a tick late. Rehydrate (idempotent; the TopBar does the same)
    // and hold the empty message until it resolves so it never flashes over a
    // campaign that is about to appear.
    let cancelled = false;
    async function hydrate() {
      await useCampaignStore.persist.rehydrate();
      if (!cancelled) setHydrated(true);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!activeCampaignId) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {hydrated ? "Select a campaign in the top bar to open its chronicle." : "Loading…"}
      </p>
    );
  }

  return <ChronicleBrowser campaignId={activeCampaignId} />;
}
