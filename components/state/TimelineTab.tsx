"use client";

import type { CampaignStateView } from "./chronicle-types";

interface TimelineTabProps {
  campaignId: string;
  state: CampaignStateView;
  onChanged: () => void;
}

/**
 * Placeholder. The real timeline list and the advance-date dialog land in the
 * next task; this exists so the Chronicle browser compiles and both tabs are
 * reachable in the meantime.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TimelineTab({ campaignId, state, onChanged }: TimelineTabProps) {
  return (
    <p className="text-sm text-muted-foreground">
      The timeline and the advance-date control are coming in the next task.
      {state.events.length > 0 && ` ${state.events.length} event(s) recorded so far.`}
    </p>
  );
}
