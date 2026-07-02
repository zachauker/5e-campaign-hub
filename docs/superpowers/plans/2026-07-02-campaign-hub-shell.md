# Campaign Hub Shell + Entity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `encounter-tracker` into the foundation of a campaign hub: add a shared entity model (characters, locations, items, factions), a top-bar + command-palette navigation shell, a campaign dashboard, and link encounter combatants to the new Character entities.

**Architecture:** Single Next.js 16 App Router app, extended in place. New Drizzle tables scoped by `campaign_id`. New `app/*` route sections wrapped by a persistent `TopBar` + `CommandPalette` in the root layout. No new services, no auth, no live external sync (Notion/D&D Beyond references are stored as static URLs/IDs only).

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM + `better-sqlite3`, Zustand, Radix UI + Tailwind v4, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-07-02-campaign-hub-shell-design.md`

**Note on verification:** This project has no test runner (no Jest/Vitest/Playwright in `package.json`). Every task is verified with `npx tsc --noEmit` (types), `npm run lint` (style), and either a `curl` check against the running dev server (API tasks) or a manual browser check (UI tasks) — matching how the rest of the codebase is currently validated.

**Note on Next.js conventions:** `AGENTS.md` warns this app pins a Next.js version with breaking changes from training data and instructs reading `node_modules/next/dist/docs/` before writing routing code. Every route/layout pattern used below (`params: Promise<{ id: string }>`, `NextResponse`, App Router file conventions) is copied directly from existing working files in this repo (`app/api/encounters/route.ts`, `app/api/library/[id]/route.ts`, `app/layout.tsx`), so no new Next.js API surface is introduced. If a step ever requires a pattern **not** already demonstrated in an existing file, stop and check `node_modules/next/dist/docs/` first.

---

## File Structure

**New files:**
- `lib/store/campaign-store.ts` — Zustand store (persisted) holding the active campaign ID.
- `lib/store/ui-store.ts` — Zustand store holding command-palette open/closed state.
- `app/api/campaigns/route.ts` — list/create campaigns.
- `app/api/characters/route.ts`, `app/api/characters/[id]/route.ts` — character CRUD.
- `app/api/characters/[id]/factions/route.ts`, `.../locations/route.ts`, `.../items/route.ts` — replace-all relationship links for a character.
- `app/api/locations/route.ts`, `app/api/locations/[id]/route.ts` — location CRUD.
- `app/api/items/route.ts`, `app/api/items/[id]/route.ts` — item CRUD.
- `app/api/factions/route.ts`, `app/api/factions/[id]/route.ts` — faction CRUD.
- `app/api/search/route.ts` — flat searchable index for the command palette.
- `components/shell/TopBar.tsx` — persistent nav bar + campaign switcher + settings link + ⌘K trigger.
- `components/shell/CommandPalette.tsx` — ⌘K jump-to-anything dialog.
- `components/entities/CharacterFormDialog.tsx` — create/edit character + relationship checkboxes.
- `components/entities/SimpleEntityManager.tsx` — generic list+form UI shared by locations/items/factions (identical shape: name, description, Notion URL).
- `app/characters/page.tsx`, `app/locations/page.tsx`, `app/items/page.tsx`, `app/factions/page.tsx` — section pages.
- `app/encounters/page.tsx` — the encounters list (moved out of `app/page.tsx`).

**Modified files:**
- `lib/db/schema.ts` — new tables + `campaignId`/`characterId` FK columns.
- `lib/db/migrate.ts` — new `CREATE TABLE` statements, additive columns, default-campaign backfill.
- `lib/types.ts` — add `characterId` to `CombatantWithParsed`.
- `app/layout.tsx` — render `TopBar` + `CommandPalette` around `children`; fix height so full-bleed screens (like the combat tracker) still fit below the bar.
- `app/page.tsx` — replaced with the new campaign dashboard.
- `app/api/encounters/route.ts` — scope by `campaignId`.
- `app/api/encounters/[id]/combatants/route.ts` — persist `characterId`.
- `app/encounters/[id]/page.tsx` — swap `h-screen` for `h-full` (now sits below the top bar) and fix two "back to encounters" links.
- `components/tracker/AddCombatantDialog.tsx` — new "Characters" tab to add a combatant linked to an existing Character entity.

---

## Task 1: Install dependencies and verify baseline

**Files:** none (setup only)

- [ ] **Step 1: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `node_modules/`.

- [ ] **Step 2: Verify the app still builds and type-checks before making changes**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors` (or equivalent clean output).

- [ ] **Step 3: Commit (only if `npm install` changed `package-lock.json`)**

```bash
git add package-lock.json
git commit -m "chore: install dependencies" --allow-empty
```

(Skip the commit if `git status` shows no changes.)

---

## Task 2: Extend the Drizzle schema with campaign entities

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add `primaryKey` to the sqlite-core import**

```typescript
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
```

- [ ] **Step 2: Add `campaignId` to the `encounters` table**

Find the `encounters` table definition and add a nullable FK column (nullable because SQLite's `ALTER TABLE ADD COLUMN` can't backfill existing rows with a dynamic value — the migration in Task 3 backfills it):

```typescript
export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["idle", "active", "completed"] }).notNull().default("idle"),
  round: integer("round").notNull().default(1),
  currentCombatantId: text("current_combatant_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 3: Add `characterId` to the `combatants` table**

Add this line inside the existing `combatants` table definition, near `ddbCharacterId`:

```typescript
  characterId: text("character_id"),
```

- [ ] **Step 4: Add the new entity tables**

Add after the `characterLibrary` table definition, before the `export type` lines:

```typescript
export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["pc", "npc"] }).notNull(),
  ddbCharacterId: text("ddb_character_id"),
  notionUrl: text("notion_url"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const factions = sqliteTable("factions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const characterFactions = sqliteTable(
  "character_factions",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    factionId: text("faction_id").notNull().references(() => factions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.factionId] })]
);

export const characterLocations = sqliteTable(
  "character_locations",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.locationId] })]
);

export const characterItems = sqliteTable(
  "character_items",
  {
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.itemId] })]
);
```

- [ ] **Step 5: Add inferred types**

Add at the end of the file, alongside the existing `export type` lines:

```typescript
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Faction = typeof factions.$inferSelect;
export type NewFaction = typeof factions.$inferInsert;
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The app won't run correctly yet — `migrate.ts` doesn't know about these tables. That's Task 3.)

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat: add campaign entity tables to Drizzle schema"
```

---

## Task 3: Extend the migration script and backfill existing data

**Files:**
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Add the new `CREATE TABLE` statements**

Inside the existing `sqlite.exec(\`...\`)` template string, add before the closing backtick (after the `character_library` table and its indexes):

```sql
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      ddb_character_id TEXT,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_factions (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      faction_id TEXT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, faction_id)
    );

    CREATE TABLE IF NOT EXISTS character_locations (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS character_items (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      PRIMARY KEY (character_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_items_campaign ON items(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id);
```

- [ ] **Step 2: Add the additive columns**

Directly below the existing `addColumnIfMissing("combatants", "ddb_character_data", "TEXT");` line, add:

```typescript
  addColumnIfMissing("combatants", "character_id", "TEXT");
  addColumnIfMissing("encounters", "campaign_id", "TEXT");
```

- [ ] **Step 3: Backfill a default campaign and attach existing encounters to it**

Add this right after the `addColumnIfMissing` calls, before `sqlite.close();`:

```typescript
  // Ensure a default campaign exists and every encounter references one.
  const existingCampaign = sqlite.prepare("SELECT id FROM campaigns LIMIT 1").get() as
    | { id: string }
    | undefined;
  let defaultCampaignId = existingCampaign?.id;
  if (!defaultCampaignId) {
    const campaignNameRow = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'campaign_name'")
      .get() as { value: string } | undefined;
    defaultCampaignId = crypto.randomUUID();
    sqlite
      .prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)")
      .run(defaultCampaignId, campaignNameRow?.value?.trim() || "My Campaign", Date.now());
  }
  sqlite
    .prepare("UPDATE encounters SET campaign_id = ? WHERE campaign_id IS NULL")
    .run(defaultCampaignId);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify the migration runs cleanly**

Run: `rm -f encounter-tracker.db* && npm run dev`
Wait for "Ready" in the output, then in a second terminal:

Run: `curl -s http://localhost:3000/api/encounters | head -c 200`
Expected: `[]` (empty array — fresh DB, no encounters yet).

Run: `sqlite3 encounter-tracker.db "SELECT name FROM campaigns;"` (or `docker run` / any sqlite3 client if not installed locally)
Expected: one row, `My Campaign`.

Stop the dev server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrate.ts
git commit -m "feat: migrate campaign entity tables and backfill default campaign"
```

---

## Task 4: Campaign store, UI store, and campaigns API

**Files:**
- Create: `lib/store/campaign-store.ts`
- Create: `lib/store/ui-store.ts`
- Create: `app/api/campaigns/route.ts`

- [ ] **Step 1: Write the campaign store**

```typescript
// lib/store/campaign-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CampaignState {
  activeCampaignId: string | null;
  setActiveCampaignId: (id: string) => void;
}

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set) => ({
      activeCampaignId: null,
      setActiveCampaignId: (id) => set({ activeCampaignId: id }),
    }),
    { name: "campaign-store" }
  )
);
```

- [ ] **Step 2: Write the UI store**

```typescript
// lib/store/ui-store.ts
import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
```

- [ ] **Step 3: Write the campaigns API route**

```typescript
// app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.query.campaigns.findMany({ orderBy: [desc(campaigns.createdAt)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const [campaign] = await db
    .insert(campaigns)
    .values({ id: generateId(), name: body.name ?? "New Campaign", createdAt: now })
    .returning();
  return NextResponse.json(campaign, { status: 201 });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify the API**

Run: `npm run dev` (in the background), then:

Run: `curl -s http://localhost:3000/api/campaigns`
Expected: JSON array with one object, `{"id":"...","name":"My Campaign","createdAt":...}`.

Run: `curl -s -X POST http://localhost:3000/api/campaigns -H "Content-Type: application/json" -d '{"name":"Test Campaign"}'`
Expected: `201` with the new campaign JSON.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add lib/store/campaign-store.ts lib/store/ui-store.ts app/api/campaigns/route.ts
git commit -m "feat: add campaign store and campaigns API"
```

---

## Task 5: Navigation shell — TopBar + layout wiring

**Files:**
- Create: `components/shell/TopBar.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the TopBar**

```tsx
// components/shell/TopBar.tsx
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
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: Campaign[]) => {
        setCampaigns(data);
        if (!activeCampaignId && data.length > 0) setActiveCampaignId(data[0].id);
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
          className="text-muted-foreground hover:text-foreground transition-colors flex-none"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Wire the TopBar and CommandPalette into the root layout, and fix full-bleed height**

`CommandPalette` doesn't exist yet (Task 6) — write the import now anyway; it'll be a type error until Task 6 lands, which is fine since we verify at the end of this task with a temporary stub. Instead, to keep this task independently verifiable, wire only the `TopBar` now and add `CommandPalette` in Task 6.

Replace the full contents of `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/shell/TopBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Campaign Hub",
  description: "D&D Campaign Management Hub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col bg-background text-foreground overflow-hidden">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
```

Note the change from `min-h-full` to `h-full overflow-hidden` on `<body>`, and `flex-1 min-h-0 overflow-y-auto` on `<main>`: this makes the top bar a fixed 48px strip and gives every page below it exactly the remaining viewport height to work with — needed so the combat tracker (which uses `h-screen` internally) doesn't get clipped. Task 12 finishes this by changing the combat tracker's own `h-screen` to `h-full`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open `http://localhost:3000` in a browser.
Expected: a slim dark top bar with "HUB", section links (Encounters/Characters/Locations/Items/Factions), a "K" button, a campaign dropdown showing "My Campaign", and a settings gear icon. Clicking "Encounters" should 404 for now (its page doesn't exist until Task 11) — that's expected at this point.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/shell/TopBar.tsx app/layout.tsx
git commit -m "feat: add top bar navigation shell"
```

---

## Task 6: Command palette + search index API

**Files:**
- Create: `app/api/search/route.ts`
- Create: `components/shell/CommandPalette.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the search index API**

```typescript
// app/api/search/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const [chars, locs, itms, facs, encs] = await Promise.all([
    db.query.characters.findMany(),
    db.query.locations.findMany(),
    db.query.items.findMany(),
    db.query.factions.findMany(),
    db.query.encounters.findMany(),
  ]);

  const results = [
    ...chars.map((c) => ({ id: c.id, name: c.name, type: "character", href: `/characters?open=${c.id}` })),
    ...locs.map((l) => ({ id: l.id, name: l.name, type: "location", href: `/locations?open=${l.id}` })),
    ...itms.map((i) => ({ id: i.id, name: i.name, type: "item", href: `/items?open=${i.id}` })),
    ...facs.map((f) => ({ id: f.id, name: f.name, type: "faction", href: `/factions?open=${f.id}` })),
    ...encs.map((e) => ({ id: e.id, name: e.name, type: "encounter", href: `/encounters/${e.id}` })),
  ];

  return NextResponse.json(results);
}
```

- [ ] **Step 2: Write the CommandPalette**

```tsx
// components/shell/CommandPalette.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/lib/store/ui-store";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface SearchResult {
  id: string;
  name: string;
  type: string;
  href: string;
}

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [allResults, setAllResults] = useState<SearchResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    fetch("/api/search")
      .then((r) => r.json())
      .then(setAllResults);
  }, [open]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    setResults(
      (q ? allResults.filter((r) => r.name.toLowerCase().includes(q)) : allResults).slice(0, 8)
    );
  }, [query, allResults]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="w-4 h-4 text-muted-foreground flex-none" />
          <Input
            autoFocus
            placeholder="Jump to a character, location, item, faction, or encounter..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="text-center py-6 text-sm text-muted-foreground">No matches.</p>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => go(r.href)}
              className="flex items-center justify-between w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm"
            >
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{r.type}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Render it in the root layout**

In `app/layout.tsx`, add the import and render it as a sibling of `<main>`:

```tsx
import { CommandPalette } from "@/components/shell/CommandPalette";
```

```tsx
      <body className="h-full flex flex-col bg-background text-foreground overflow-hidden">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
        <CommandPalette />
      </body>
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: pressing ⌘K (or Ctrl+K) opens a search dialog. Clicking the "K" button in the top bar does the same. Typing filters an (empty, since no entities exist yet) result list without errors in the browser console.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/search/route.ts components/shell/CommandPalette.tsx app/layout.tsx
git commit -m "feat: add command palette and search index"
```

---

## Task 7: Characters API — CRUD + relationship links

**Files:**
- Create: `app/api/characters/route.ts`
- Create: `app/api/characters/[id]/route.ts`
- Create: `app/api/characters/[id]/factions/route.ts`
- Create: `app/api/characters/[id]/locations/route.ts`
- Create: `app/api/characters/[id]/items/route.ts`

- [ ] **Step 1: List/create route**

```typescript
// app/api/characters/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.characters.findMany({
        where: eq(characters.campaignId, campaignId),
        orderBy: [asc(characters.name)],
      })
    : await db.query.characters.findMany({ orderBy: [asc(characters.name)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const [character] = await db
    .insert(characters)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name,
      type: body.type ?? "npc",
      ddbCharacterId: body.ddbCharacterId ?? null,
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(character, { status: 201 });
}
```

- [ ] **Step 2: Get/update/delete route, including relationship IDs on GET**

```typescript
// app/api/characters/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [factionLinks, locationLinks, itemLinks] = await Promise.all([
    db.query.characterFactions.findMany({ where: eq(characterFactions.characterId, id) }),
    db.query.characterLocations.findMany({ where: eq(characterLocations.characterId, id) }),
    db.query.characterItems.findMany({ where: eq(characterItems.characterId, id) }),
  ]);

  return NextResponse.json({
    ...row,
    factionIds: factionLinks.map((l) => l.factionId),
    locationIds: locationLinks.map((l) => l.locationId),
    itemIds: itemLinks.map((l) => l.itemId),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.characters.findFirst({ where: eq(characters.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(characters)
    .set({
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      ddbCharacterId: body.ddbCharacterId ?? existing.ddbCharacterId,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(characters.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(characters).where(eq(characters.id, id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Relationship replace-all routes**

```typescript
// app/api/characters/[id]/factions/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterFactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { factionIds: string[] };

  await db.delete(characterFactions).where(eq(characterFactions.characterId, characterId));
  if (body.factionIds.length > 0) {
    await db.insert(characterFactions).values(
      body.factionIds.map((factionId) => ({ characterId, factionId }))
    );
  }

  return NextResponse.json({ ok: true });
}
```

```typescript
// app/api/characters/[id]/locations/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLocations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { locationIds: string[] };

  await db.delete(characterLocations).where(eq(characterLocations.characterId, characterId));
  if (body.locationIds.length > 0) {
    await db.insert(characterLocations).values(
      body.locationIds.map((locationId) => ({ characterId, locationId }))
    );
  }

  return NextResponse.json({ ok: true });
}
```

```typescript
// app/api/characters/[id]/items/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const body = (await req.json()) as { itemIds: string[] };

  await db.delete(characterItems).where(eq(characterItems.characterId, characterId));
  if (body.itemIds.length > 0) {
    await db.insert(characterItems).values(
      body.itemIds.map((itemId) => ({ characterId, itemId }))
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, then in another terminal capture a campaign ID:

```bash
CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
CHAR=$(curl -s -X POST http://localhost:3000/api/characters -H "Content-Type: application/json" \
  -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"name\":\"Test NPC\",\"type\":\"npc\"}")
echo "$CHAR"
CHAR_ID=$(echo "$CHAR" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
curl -s http://localhost:3000/api/characters/$CHAR_ID
```

Expected: the final `curl` returns the character with `factionIds: []`, `locationIds: []`, `itemIds: []`.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/characters
git commit -m "feat: add characters API with relationship links"
```

---

## Task 8: Characters UI — form dialog + section page

**Files:**
- Create: `components/entities/CharacterFormDialog.tsx`
- Create: `app/characters/page.tsx`

- [ ] **Step 1: Write the character form dialog**

```tsx
// components/entities/CharacterFormDialog.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Character, Faction, Location, Item } from "@/lib/db/schema";

export type CharacterWithLinks = Character & {
  factionIds: string[];
  locationIds: string[];
  itemIds: string[];
};

interface CharacterFormDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  character?: CharacterWithLinks | null;
  onSaved: () => void;
}

export function CharacterFormDialog({
  open,
  onClose,
  campaignId,
  character,
  onSaved,
}: CharacterFormDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"pc" | "npc">("npc");
  const [description, setDescription] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [ddbCharacterId, setDdbCharacterId] = useState("");
  const [factions, setFactions] = useState<Faction[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factionIds, setFactionIds] = useState<string[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(character?.name ?? "");
    setType(character?.type ?? "npc");
    setDescription(character?.description ?? "");
    setNotionUrl(character?.notionUrl ?? "");
    setDdbCharacterId(character?.ddbCharacterId ?? "");
    setFactionIds(character?.factionIds ?? []);
    setLocationIds(character?.locationIds ?? []);
    setItemIds(character?.itemIds ?? []);

    Promise.all([
      fetch("/api/factions").then((r) => r.json()),
      fetch("/api/locations").then((r) => r.json()),
      fetch("/api/items").then((r) => r.json()),
    ]).then(([f, l, i]) => {
      setFactions(f);
      setLocations(l);
      setItems(i);
    });
  }, [open, character]);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        campaignId,
        name: name.trim(),
        type,
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
        ddbCharacterId: ddbCharacterId.trim() || null,
      };

      let id = character?.id;
      if (!id) {
        const created = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        id = created.id;
      } else {
        await fetch(`/api/characters/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      await Promise.all([
        fetch(`/api/characters/${id}/factions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factionIds }),
        }),
        fetch(`/api/characters/${id}/locations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationIds }),
        }),
        fetch(`/api/characters/${id}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds }),
        }),
      ]);

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function RelationList({
    list,
    selected,
    onToggle,
  }: {
    list: { id: string; name: string }[];
    selected: string[];
    onToggle: (id: string) => void;
  }) {
    return (
      <ScrollArea className="h-28 border border-border rounded-md p-2">
        {list.length === 0 && <p className="text-xs text-muted-foreground px-1">None yet.</p>}
        {list.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer hover:bg-accent rounded"
          >
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
            {item.name}
          </label>
        ))}
      </ScrollArea>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{character ? "Edit Character" : "New Character"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <Input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="flex gap-2">
            <button
              onClick={() => setType("pc")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-sm border",
                type === "pc" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              PC
            </button>
            <button
              onClick={() => setType("npc")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-sm border",
                type === "npc" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              NPC
            </button>
          </div>

          <textarea
            placeholder="Description / notes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <Input
            placeholder="Notion page URL (optional)"
            value={notionUrl}
            onChange={(e) => setNotionUrl(e.target.value)}
          />
          <Input
            placeholder="D&D Beyond character ID (optional)"
            value={ddbCharacterId}
            onChange={(e) => setDdbCharacterId(e.target.value)}
          />

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Factions</label>
            <RelationList list={factions} selected={factionIds} onToggle={(id) => toggle(factionIds, setFactionIds, id)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Locations</label>
            <RelationList
              list={locations}
              selected={locationIds}
              onToggle={(id) => toggle(locationIds, setLocationIds, id)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Items</label>
            <RelationList list={items} selected={itemIds} onToggle={(id) => toggle(itemIds, setItemIds, id)} />
          </div>

          <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : character ? "Save Changes" : "Create Character"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the characters page**

```tsx
// app/characters/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import type { Character } from "@/lib/db/schema";

export default function CharactersPage() {
  const searchParams = useSearchParams();
  const { activeCampaignId } = useCampaignStore();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CharacterWithLinks | null>(null);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/characters?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setCharacters);
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = useCallback(async (id: string) => {
    const res = await fetch(`/api/characters/${id}`);
    if (!res.ok) return;
    const data: CharacterWithLinks = await res.json();
    setEditing(data);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) openEdit(openId);
  }, [searchParams, openEdit]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this character?")) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = characters.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg flex items-center gap-2">
          <Users className="w-4 h-4" /> Characters
        </h1>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="w-4 h-4" /> New Character
        </Button>
      </div>

      <Input placeholder="Search characters..." value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No characters yet.
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => openEdit(c.id)}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer group"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{c.name}</p>
            </div>
            <Badge variant={c.type === "pc" ? "hp" : "outline"} className="capitalize">
              {c.type}
            </Badge>
            <Button
              size="icon-sm"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
              onClick={(e) => remove(c.id, e)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <CharacterFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        campaignId={activeCampaignId ?? ""}
        character={editing}
        onSaved={load}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open `http://localhost:3000/characters`.
Expected: "New Character" creates a character via the dialog; it appears in the list; clicking it reopens the dialog pre-filled; checking a faction/location/item checkbox and saving persists (reopen to confirm the checkbox stays checked); delete removes it from the list.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/entities/CharacterFormDialog.tsx app/characters/page.tsx
git commit -m "feat: add characters section UI"
```

---

## Task 9: Locations, Items, Factions API

**Files:**
- Create: `app/api/locations/route.ts`, `app/api/locations/[id]/route.ts`
- Create: `app/api/items/route.ts`, `app/api/items/[id]/route.ts`
- Create: `app/api/factions/route.ts`, `app/api/factions/[id]/route.ts`

- [ ] **Step 1: Locations routes**

```typescript
// app/api/locations/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.locations.findMany({ where: eq(locations.campaignId, campaignId), orderBy: [asc(locations.name)] })
    : await db.query.locations.findMany({ orderBy: [asc(locations.name)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const [location] = await db
    .insert(locations)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name,
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(location, { status: 201 });
}
```

```typescript
// app/api/locations/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(locations)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(locations).where(eq(locations.id, id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Items routes (identical shape, `items` table)**

```typescript
// app/api/items/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.items.findMany({ where: eq(items.campaignId, campaignId), orderBy: [asc(items.name)] })
    : await db.query.items.findMany({ orderBy: [asc(items.name)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const [item] = await db
    .insert(items)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name,
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(item, { status: 201 });
}
```

```typescript
// app/api/items/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(items)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(items.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(items).where(eq(items.id, id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Factions routes (identical shape, `factions` table)**

```typescript
// app/api/factions/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.factions.findMany({ where: eq(factions.campaignId, campaignId), orderBy: [asc(factions.name)] })
    : await db.query.factions.findMany({ orderBy: [asc(factions.name)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const [faction] = await db
    .insert(factions)
    .values({
      id: generateId(),
      campaignId: body.campaignId,
      name: body.name,
      notionUrl: body.notionUrl ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(faction, { status: 201 });
}
```

```typescript
// app/api/factions/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.factions.findFirst({ where: eq(factions.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.factions.findFirst({ where: eq(factions.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(factions)
    .set({
      name: body.name ?? existing.name,
      notionUrl: body.notionUrl ?? existing.notionUrl,
      description: body.description ?? existing.description,
      updatedAt: new Date(),
    })
    .where(eq(factions.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(factions).where(eq(factions.id, id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify (locations shown; items/factions follow the same shape)**

Run: `npm run dev`, then:

```bash
CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
curl -s -X POST http://localhost:3000/api/locations -H "Content-Type: application/json" \
  -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"name\":\"Whitestone\"}"
curl -s "http://localhost:3000/api/locations?campaignId=$CAMPAIGN_ID"
```

Expected: the second `curl` returns an array containing "Whitestone". Repeat for `/api/items` and `/api/factions` with any test name.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/locations app/api/items app/api/factions
git commit -m "feat: add locations, items, and factions API"
```

---

## Task 10: Locations, Items, Factions UI

**Files:**
- Create: `components/entities/SimpleEntityManager.tsx`
- Create: `app/locations/page.tsx`
- Create: `app/items/page.tsx`
- Create: `app/factions/page.tsx`

- [ ] **Step 1: Write the shared manager component**

```tsx
// components/entities/SimpleEntityManager.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface SimpleEntity {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
}

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const searchParams = useSearchParams();
  const { activeCampaignId } = useCampaignStore();
  const [entities, setEntities] = useState<SimpleEntity[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SimpleEntity | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/${resourcePath}?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setEntities);
  }, [activeCampaignId, resourcePath]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/${resourcePath}/${id}`);
      if (!res.ok) return;
      const entity: SimpleEntity = await res.json();
      setEditing(entity);
      setName(entity.name);
      setDescription(entity.description ?? "");
      setNotionUrl(entity.notionUrl ?? "");
      setDialogOpen(true);
    },
    [resourcePath]
  );

  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) openEdit(openId);
  }, [searchParams, openEdit]);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setNotionUrl("");
    setDialogOpen(true);
  }

  async function save() {
    if (!name.trim() || !activeCampaignId) return;
    setSaving(true);
    try {
      const payload = {
        campaignId: activeCampaignId,
        name: name.trim(),
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
      };
      if (editing) {
        await fetch(`/api/${resourcePath}/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/${resourcePath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete this ${label.toLowerCase().replace(/s$/, "")}?`)) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    setEntities((prev) => prev.filter((x) => x.id !== id));
  }

  const filtered = entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg flex items-center gap-2">
          <Icon className="w-4 h-4" /> {label}
        </h1>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="w-4 h-4" /> New {label.replace(/s$/, "")}
        </Button>
      </div>

      <Input placeholder={`Search ${label.toLowerCase()}...`} value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No {label.toLowerCase()} yet.
          </div>
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            onClick={() => openEdit(e.id)}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer group"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{e.name}</p>
              {e.description && <p className="text-xs text-muted-foreground truncate">{e.description}</p>}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
              onClick={(ev) => remove(e.id, ev)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${label.replace(/s$/, "")}` : `New ${label.replace(/s$/, "")}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Input placeholder="Notion page URL (optional)" value={notionUrl} onChange={(e) => setNotionUrl(e.target.value)} />
            <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Write the three thin page wrappers**

```tsx
// app/locations/page.tsx
"use client";

import { MapPin } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function LocationsPage() {
  return <SimpleEntityManager resourcePath="locations" label="Locations" icon={MapPin} />;
}
```

```tsx
// app/items/page.tsx
"use client";

import { Package } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function ItemsPage() {
  return <SimpleEntityManager resourcePath="items" label="Items" icon={Package} />;
}
```

```tsx
// app/factions/page.tsx
"use client";

import { Shield } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function FactionsPage() {
  return <SimpleEntityManager resourcePath="factions" label="Factions" icon={Shield} />;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, visit `/locations`, `/items`, `/factions`.
Expected: each page lists/creates/edits/deletes its entity type independently. Back in `/characters`, the relationship checklists (Task 8) now show the locations/items/factions you just created.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/entities/SimpleEntityManager.tsx app/locations app/items app/factions
git commit -m "feat: add locations, items, and factions section UI"
```

---

## Task 11: Campaign dashboard and encounters section

**Files:**
- Create: `app/encounters/page.tsx` (moved from the old `app/page.tsx`)
- Modify: `app/page.tsx` (replaced with the dashboard)
- Modify: `app/api/encounters/route.ts`

- [ ] **Step 1: Move the encounters list to `app/encounters/page.tsx`**

Copy the current contents of `app/page.tsx` into a new file `app/encounters/page.tsx`, then remove the `<header>` block (the top bar now provides navigation and the settings link) and update the create-encounter call to send `campaignId`:

```tsx
// app/encounters/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Swords,
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  PlayCircle,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { Encounter } from "@/lib/db/schema";

const STATUS_CONFIG = {
  idle: { label: "Ready", icon: <Clock className="w-3 h-3" /> },
  active: { label: "Active", icon: <PlayCircle className="w-3 h-3" /> },
  completed: { label: "Done", icon: <CheckCircle2 className="w-3 h-3" /> },
};

export default function EncountersPage() {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/encounters")
      .then((r) => r.json())
      .then((data) => {
        setEncounters(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function createEncounter() {
    if (!newName.trim() || !activeCampaignId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/encounters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), campaignId: activeCampaignId }),
      });
      const encounter = await res.json();
      router.push(`/encounters/${encounter.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function deleteEncounter(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this encounter?")) return;
    await fetch(`/api/encounters/${id}`, { method: "DELETE" });
    setEncounters((prev) => prev.filter((enc) => enc.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h2 className="font-semibold">New Encounter</h2>
        <div className="flex gap-2">
          <Input
            placeholder="Encounter name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createEncounter()}
            className="flex-1"
          />
          <Button onClick={createEncounter} disabled={creating || !newName.trim()} className="gap-1.5">
            <Plus className="w-4 h-4" />
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
          Encounters ({encounters.length})
        </h2>

        {loading && <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>}

        {!loading && encounters.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No encounters yet. Create one above.</p>
          </div>
        )}

        <div className="space-y-2">
          {encounters.map((enc) => {
            const status = STATUS_CONFIG[enc.status as keyof typeof STATUS_CONFIG];
            return (
              <div
                key={enc.id}
                onClick={() => router.push(`/encounters/${enc.id}`)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg border flex items-center justify-center flex-none",
                    enc.status === "active" && "border-primary/40 bg-primary/10",
                    enc.status === "idle" && "border-border bg-muted",
                    enc.status === "completed" && "border-muted bg-muted/50"
                  )}
                >
                  <Swords
                    className={cn(
                      "w-4 h-4",
                      enc.status === "active" && "text-primary",
                      (enc.status === "idle" || enc.status === "completed") && "text-muted-foreground"
                    )}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{enc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(new Date(enc.updatedAt))}
                    {enc.round > 1 && ` · Round ${enc.round}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-none">
                  <span
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                      enc.status === "active" && "text-primary border-primary/40 bg-primary/10",
                      (enc.status === "idle" || enc.status === "completed") && "text-muted-foreground border-border"
                    )}
                  >
                    {status.icon} {status.label}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                    onClick={(e) => deleteEncounter(enc.id, e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `app/page.tsx` with the campaign dashboard**

```tsx
// app/page.tsx
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
      .then((data: Encounter[]) => setRecentEncounters(data.slice(0, 5)));
  }, []);

  useEffect(() => {
    if (!activeCampaignId) return;
    Promise.all([
      fetch(`/api/characters?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/locations?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/items?campaignId=${activeCampaignId}`).then((r) => r.json()),
      fetch(`/api/factions?campaignId=${activeCampaignId}`).then((r) => r.json()),
    ]).then(([c, l, i, f]) =>
      setCounts({ characters: c.length, locations: l.length, items: i.length, factions: f.length })
    );
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
```

- [ ] **Step 3: Scope encounter creation/listing by campaign**

In `app/api/encounters/route.ts`, update both handlers:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encounters, combatants } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { desc, eq } from "drizzle-orm";
import type { CombatantWithParsed, Condition } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const rows = campaignId
    ? await db.query.encounters.findMany({
        where: eq(encounters.campaignId, campaignId),
        orderBy: [desc(encounters.updatedAt)],
      })
    : await db.query.encounters.findMany({ orderBy: [desc(encounters.updatedAt)] });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date();
  const id = generateId();

  const [encounter] = await db
    .insert(encounters)
    .values({
      id,
      campaignId: body.campaignId ?? null,
      name: body.name ?? "New Encounter",
      status: "idle",
      round: 1,
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(encounter, { status: 201 });
}
```

(`GET` stays unfiltered when no `campaignId` is passed — the dashboard's "recent encounters" query intentionally doesn't filter, matching current single-campaign usage; Task types are unchanged, only the query and insert gained `campaignId`.)

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: the dashboard loads with 4 section cards showing counts, and a "Recent Encounters" list (populated from any encounters created in earlier tasks' manual tests). Visiting `/encounters` shows the full list and lets you create a new one — creating one and checking `curl http://localhost:3000/api/encounters` shows the new row with a non-null `campaignId`.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/encounters/page.tsx app/api/encounters/route.ts
git commit -m "feat: add campaign dashboard and move encounters list to /encounters"
```

---

## Task 12: Link encounter combatants to Character entities

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/api/encounters/[id]/combatants/route.ts`
- Modify: `app/encounters/[id]/page.tsx`
- Modify: `components/tracker/AddCombatantDialog.tsx`

- [ ] **Step 1: Add `characterId` to `CombatantWithParsed`**

In `lib/types.ts`, add this field to the `CombatantWithParsed` interface, next to `ddbCharacterId`:

```typescript
  characterId: string | null;
```

- [ ] **Step 2: Persist `characterId` when creating a combatant**

In `app/api/encounters/[id]/combatants/route.ts`, add this line to the `.values({...})` object passed to `db.insert(combatants)`, alongside `ddbCharacterId`:

```typescript
      characterId: body.characterId ?? null,
```

- [ ] **Step 3: Fix full-bleed height now that the combat tracker sits below the top bar**

In `app/encounters/[id]/page.tsx`, make these three replacements:

```typescript
// Before: <div className="flex items-center justify-center h-screen">
// After:
      <div className="flex items-center justify-center h-full">
```

```typescript
// Before: <div className="flex flex-col items-center justify-center h-screen gap-4">
// After:
      <div className="flex flex-col items-center justify-center h-full gap-4">
```

```typescript
// Before: <div className="flex flex-col h-screen overflow-hidden">
// After:
    <div className="flex flex-col h-full overflow-hidden">
```

Also update the two "back to encounters" navigation targets in the same file, from `router.push("/")` to `router.push("/encounters")`:

```typescript
        <Button onClick={() => router.push("/encounters")}>Back to Encounters</Button>
```

```typescript
            onNavigateBack={() => router.push("/encounters")}
```

- [ ] **Step 4: Add a "Characters" tab to `AddCombatantDialog`**

In `components/tracker/AddCombatantDialog.tsx`:

Add `Users` to the existing `lucide-react` import list (alongside `Sword`, `User`, `Zap`, ...).

Change the `Tab` type:

```typescript
type Tab = "monster" | "npc" | "upload" | "library" | "ddb" | "characters";
```

Add a new interface near `LibraryEntry`:

```typescript
interface CharacterEntity {
  id: string;
  name: string;
  type: string;
}
```

Add new state, alongside the existing `libraryEntries`/`loadingLibrary` state:

```typescript
  const [characterEntities, setCharacterEntities] = useState<CharacterEntity[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [linkingCharacter, setLinkingCharacter] = useState<CharacterEntity | null>(null);
  const [linkForm, setLinkForm] = useState({ ac: "10", hpMax: "10", initiative: "" });
```

Extend the tab-change effect:

```typescript
  useEffect(() => {
    if (tab === "ddb") loadDDBCharacters();
    if (tab === "library") loadLibrary(libraryQuery);
    if (tab === "characters") loadCharacterEntities();
  }, [tab]);
```

Add the loader and the add-combatant function, near `loadLibrary`:

```typescript
  async function loadCharacterEntities() {
    setLoadingCharacters(true);
    try {
      const res = await fetch("/api/characters");
      setCharacterEntities(await res.json());
    } finally {
      setLoadingCharacters(false);
    }
  }

  async function addLinkedCharacter() {
    if (!encounter || !linkingCharacter) return;
    const combatant: CombatantWithParsed = {
      id: generateId(),
      encounterId: encounter.id,
      name: linkingCharacter.name,
      type: linkingCharacter.type === "pc" ? "pc" : "npc",
      initiative: linkForm.initiative ? parseFloat(linkForm.initiative) : null,
      initiativeBonus: 0,
      hpCurrent: parseInt(linkForm.hpMax, 10) || 10,
      hpMax: parseInt(linkForm.hpMax, 10) || 10,
      hpTemp: 0,
      ac: parseInt(linkForm.ac, 10) || 10,
      speed: 30,
      conditions: [],
      notes: null,
      isConcentrating: false,
      isVisible: true,
      sortOrder: encounter.combatants.length,
      ddbCharacterId: null,
      monsterSlug: null,
      statBlock: null,
      avatarUrl: null,
      playerName: null,
      color: null,
      characterId: linkingCharacter.id,
    };
    addCombatant(combatant);
    await persistCombatant(combatant);
    setLinkingCharacter(null);
    setLinkForm({ ac: "10", hpMax: "10", initiative: "" });
    onClose();
  }
```

Every other object literal that constructs a `CombatantWithParsed` needs a `characterId` field now that it's required by the type. Make these four exact edits:

In `components/tracker/AddCombatantDialog.tsx`, inside `addMonster`, change:

```typescript
          ddbCharacterId: null,
          monsterSlug: result.slug,
          statBlock,
          avatarUrl: statBlock.imageUrl ?? null,
          playerName: null,
          color: null,
        };
```

to:

```typescript
          ddbCharacterId: null,
          monsterSlug: result.slug,
          statBlock,
          avatarUrl: statBlock.imageUrl ?? null,
          playerName: null,
          color: null,
          characterId: null,
        };
```

Inside `addNPC`, change:

```typescript
      ddbCharacterId: null,
      monsterSlug: null,
      statBlock: null,
      avatarUrl: null,
      playerName: null,
      color: null,
    };
```

to:

```typescript
      ddbCharacterId: null,
      monsterSlug: null,
      statBlock: null,
      avatarUrl: null,
      playerName: null,
      color: null,
      characterId: null,
    };
```

Inside `addDDBCharacter`, change:

```typescript
      ddbCharacter: char,
      avatarUrl: char.avatarUrl ?? null,
      playerName: char.playerName ?? null,
      color: null,
    };
```

to:

```typescript
      ddbCharacter: char,
      avatarUrl: char.avatarUrl ?? null,
      playerName: char.playerName ?? null,
      color: null,
      characterId: null,
    };
```

In `lib/character-schema.ts`, inside `characterUploadToCombatant` (used by `addFromUpload` and `addFromLibrary`), change:

```typescript
    avatarUrl: data.avatarUrl ?? data.statBlock?.imageUrl ?? null,
    playerName: data.playerName ?? null,
    color: data.color ?? null,
  };
}
```

to:

```typescript
    avatarUrl: data.avatarUrl ?? data.statBlock?.imageUrl ?? null,
    playerName: data.playerName ?? null,
    color: data.color ?? null,
    characterId: null,
  };
}
```

Add the new tab entry to the `tabs` array:

```typescript
    { key: "characters", label: "Characters", icon: <Users className="w-3.5 h-3.5" /> },
```

Add the new tab's JSX block, alongside the existing `{tab === "library" && (...)}` block:

```tsx
        {tab === "characters" && (
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
            {!linkingCharacter ? (
              <ScrollArea className="flex-1">
                {loadingCharacters && (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
                {!loadingCharacters && characterEntities.length === 0 && (
                  <p className="text-center py-8 text-muted-foreground text-sm">
                    No characters yet. Add them from the Characters section.
                  </p>
                )}
                <div className="space-y-1.5">
                  {characterEntities.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setLinkingCharacter(c)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <span className="font-medium text-sm flex-1">{c.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">{c.type}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">
                  Adding <strong>{linkingCharacter.name}</strong> to combat
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">AC</label>
                    <Input
                      type="number"
                      value={linkForm.ac}
                      onChange={(e) => setLinkForm({ ...linkForm, ac: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Max HP</label>
                    <Input
                      type="number"
                      value={linkForm.hpMax}
                      onChange={(e) => setLinkForm({ ...linkForm, hpMax: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Initiative</label>
                    <Input
                      type="number"
                      placeholder="—"
                      value={linkForm.initiative}
                      onChange={(e) => setLinkForm({ ...linkForm, initiative: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setLinkingCharacter(null)}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={addLinkedCharacter}>
                    <Plus className="w-4 h-4" /> Add
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`tsc` will catch any `CombatantWithParsed` literal missing the new required `characterId` field — fix any it flags.)

- [ ] **Step 6: Manually verify**

Run: `npm run dev`. Open `/characters`, create a character named "Test Merchant" (type NPC). Open `/encounters`, create an encounter, open it, click "Add Combatant" → "Characters" tab. Confirm "Test Merchant" is listed; click it, fill AC/HP, click "Add".
Expected: the combatant appears in the initiative tracker named "Test Merchant". Confirm via: `curl -s http://localhost:3000/api/encounters/<encounter-id> | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).combatants[0].characterId))"` — expected output is the character's ID, not `null`.

Also confirm the combat screen fills the viewport correctly below the top bar (no clipped content, no double scrollbars) at both desktop and mobile widths.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/character-schema.ts app/api/encounters/[id]/combatants/route.ts app/encounters/[id]/page.tsx components/tracker/AddCombatantDialog.tsx
git commit -m "feat: link encounter combatants to character entities"
```

---

## Task 13: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Fresh-install smoke test**

Run: `rm -f encounter-tracker.db* && npm install && npm run build && npm run start`
Expected: build succeeds, server starts on port 3000 without errors in the logs.

- [ ] **Step 2: Walk the golden path in a browser**

1. Open `http://localhost:3000` → dashboard renders with 0 counts everywhere, no active encounter, no recent encounters.
2. Create a Faction ("The Myriad"), a Location ("Whitestone"), an Item ("Deathwalker's Ward") via their section pages.
3. Create a Character ("Percy", PC) and link it to the faction/location/item just created; save; reopen the character to confirm the links persisted.
4. Press ⌘K, type "Percy" → the result appears and clicking it opens `/characters?open=<id>` with the edit dialog pre-filled.
5. Go to `/encounters`, create an encounter, open it, add "Percy" via the Characters tab in Add Combatant, adjust HP, advance a turn.
6. Return to `/` (dashboard) → the active encounter banner shows this encounter; the section cards now show counts of 1.

Expected: no console errors at any step (check via browser devtools), no 404s on any API call (check the Network tab).

- [ ] **Step 3: Existing-data migration sanity check**

If you have a real `encounter-tracker.db` from before this plan (e.g. a backup of production data), copy it into the project root, run `npm run dev`, and confirm:
- `curl -s http://localhost:3000/api/encounters` still returns all pre-existing encounters.
- `curl -s http://localhost:3000/api/campaigns` returns exactly one campaign.
- Opening any pre-existing encounter still loads its combatants with HP/conditions intact.

- [ ] **Step 4: Stop the server — no commit for this task (verification only)**
