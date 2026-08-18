import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/lib/db/schema";

/** Matches AppDb in lib/assistant/read-tools.ts — same drizzle instance shape. */
export type StateDb = BetterSQLite3Database<typeof schema>;
