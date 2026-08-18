import type { ClockStatus } from "./cadence";

/**
 * The client-safe half of the clock vocabulary.
 *
 * Split out of `clocks.ts` so the clock form can share one source of truth for
 * these without importing the repo — `clocks.ts` reaches `lib/db/schema`, which
 * would drag every drizzle table definition into the browser bundle for the sake
 * of a four-element array. This module has no runtime imports at all.
 *
 * `clocks.ts` re-exports all three, so server-side importers need not know this
 * file exists.
 */

export const CLOCK_STATUSES: ClockStatus[] = ["running", "paused", "complete"];

export const CLOCK_SEGMENT_CHOICES = [4, 6, 8, 12] as const;

export type ClockOwnerKind = "faction" | "location" | "thread";
