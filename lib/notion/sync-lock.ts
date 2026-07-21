/**
 * In-process lock guarding against concurrent syncs of the same campaign.
 * The manual API route and the background scheduler both run inside the single
 * standalone Node server process, so a module-level Set is sufficient — no DB
 * or cross-process lock is needed.
 */
const inFlight = new Set<string>();

/** Returns true if the lock was acquired, false if the campaign is already syncing. */
export function tryAcquireSync(campaignId: string): boolean {
  if (inFlight.has(campaignId)) return false;
  inFlight.add(campaignId);
  return true;
}

/** Releases the lock for a campaign. Safe to call even if not held. */
export function releaseSync(campaignId: string): void {
  inFlight.delete(campaignId);
}

/** Whether a sync is currently running for this campaign. */
export function isSyncing(campaignId: string): boolean {
  return inFlight.has(campaignId);
}
