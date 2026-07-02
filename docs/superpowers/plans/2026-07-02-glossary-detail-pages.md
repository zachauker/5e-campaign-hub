# Glossary Detail Pages + Notion/D&D Beyond Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every campaign entity (character, location, item, faction) a real detail page with tabbed Overview / Notion Notes / (Characters only) D&D Beyond content, replacing the current click-to-edit-dialog interaction.

**Architecture:** New `/characters/[id]`, `/locations/[id]`, `/items/[id]`, `/factions/[id]` routes. Notion content is fetched server-side (official SDK, new dependency) and rendered client-side via a small block renderer. D&D Beyond content reuses the existing `fetchPublicCharacter` client and `StatBlock` component. List pages change from "click row → open edit dialog" to "click row → navigate to detail page"; editing becomes an explicit action on the detail page.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM + `better-sqlite3`, `@notionhq/client` (new), Radix UI (`@radix-ui/react-tabs`, already a dependency but unused until now) + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-02-glossary-detail-pages-design.md`

**Note on verification:** This project has no test runner. Every task is verified with `npx tsc --noEmit`, `npm run lint`, and either a `curl` check (API tasks) or a manual browser check (UI tasks) — matching the rest of this codebase's established verification approach.

**Note on Next.js conventions:** Follow the exact patterns already established in this codebase (`params: Promise<{ id: string }>` for dynamic routes, `NextResponse.json`, `"use client"` + explicit `Suspense` boundaries around any `useSearchParams()` usage — this codebase hit a real production-build failure from a missing Suspense boundary in an earlier sub-project, so treat that as a hard rule, not a suggestion). This plan's UI tasks avoid `useSearchParams()` entirely where possible (see Task 11), sidestepping the issue rather than needing new Suspense boundaries.

---

## File Structure

**New files:**
- `lib/notion/client.ts` — Notion page-ID extraction + block fetching (server-side only).
- `app/api/notion/page/route.ts` — GET endpoint wrapping the Notion client for the browser to call.
- `components/glossary/NotionBlocks.tsx` — renders fetched Notion blocks as JSX.
- `components/glossary/RelatedCard.tsx` — small clickable card linking to another entity's detail page.
- `components/entities/SimpleEntityFormDialog.tsx` — the create/edit dialog extracted out of `SimpleEntityManager` so both the list page and the new detail pages can render it.
- `components/glossary/SimpleEntityDetail.tsx` — shared detail-page component for Locations/Items/Factions (Overview + Notion Notes tabs, parameterized like `SimpleEntityManager`).
- `components/ui/tabs.tsx` — Radix `react-tabs` wrapper, matching this codebase's existing `components/ui/*` shadcn-style pattern.
- `app/characters/[id]/page.tsx` — Character detail page (Overview / Notion Notes / D&D Beyond).
- `app/locations/[id]/page.tsx`, `app/items/[id]/page.tsx`, `app/factions/[id]/page.tsx` — thin wrappers around `SimpleEntityDetail`.

**Modified files:**
- `package.json` — add `@notionhq/client`.
- `lib/db/schema.ts` — no changes (all needed columns already exist from the hub shell sub-project).
- `app/api/settings/route.ts` — add `notion_token` to `ALLOWED_KEYS` and to the masked-key list.
- `app/settings/page.tsx` — add a Notion Integration section (token input), matching the existing D&D Beyond section's style.
- `lib/ddb/client.ts` — add `ddbCharacterToStatBlock`, a fuller DDB→`StatBlock` mapping for the detail page (the existing simplified inline mapping in `AddCombatantDialog` is untouched — different use case, no need to touch working combat code).
- `app/api/locations/[id]/route.ts`, `app/api/items/[id]/route.ts`, `app/api/factions/[id]/route.ts` — GET gains a reverse-relationship query (`linkedCharacters`).
- `components/entities/SimpleEntityManager.tsx` — uses the new `SimpleEntityFormDialog`; row click navigates to the detail page instead of opening the dialog; `useSearchParams`/`Suspense` removed entirely (no longer needed).
- `app/characters/page.tsx` — row click navigates to the detail page instead of opening the dialog; `useSearchParams`/`Suspense` removed entirely.
- `app/api/search/route.ts` — result hrefs point to the new detail-page routes instead of `?open=<id>`.

---

## Task 1: Notion dependency + Settings token field

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `app/api/settings/route.ts`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Install the Notion SDK**

Run: `npm install @notionhq/client`
Expected: adds `@notionhq/client` to `package.json` dependencies, updates `package-lock.json`.

- [ ] **Step 2: Add `notion_token` to the settings allowlist and masking**

In `app/api/settings/route.ts`, change:

```typescript
const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls"];

export async function GET() {
  const rows = await db.query.settings.findMany();
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key !== "ddb_cobalt_token") {
      result[row.key] = row.value;
    } else {
      result[row.key] = row.value ? "configured" : "";
    }
  }
  return NextResponse.json(result);
}
```

to:

```typescript
const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls", "notion_token"];
const MASKED_KEYS = new Set(["ddb_cobalt_token", "notion_token"]);

export async function GET() {
  const rows = await db.query.settings.findMany();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = MASKED_KEYS.has(row.key) ? (row.value ? "configured" : "") : row.value;
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Add a Notion Integration section to the Settings page**

In `app/settings/page.tsx`, add `Sparkles` (or reuse `Info`) to the `lucide-react` import if not already present, add state for the token, load/save it, and add a section matching the existing "D&D Beyond Characters" section's style.

Add state near the existing state declarations:

```typescript
  const [notionToken, setNotionToken] = useState("");
  const [notionConfigured, setNotionConfigured] = useState(false);
```

Update the settings-load effect:

```typescript
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setCampaignName(data.campaign_name ?? "");
        try { setShareUrls(JSON.parse(data.ddb_share_urls ?? "[]")); } catch {}
        setNotionConfigured(Boolean(data.notion_token));
      });
  }, []);
```

Add a save handler for the token (separate from the general `save()`, since a token shouldn't be silently overwritten with an empty string if the field is just left blank after being configured once):

```typescript
  async function saveNotionToken() {
    if (!notionToken.trim()) return;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notion_token: notionToken.trim() }),
    });
    setNotionConfigured(true);
    setNotionToken("");
  }
```

Add the section in the JSX, after the "D&D Beyond Characters" `</section>` and before the final `<Button onClick={save} ...>`:

```tsx
        {/* Notion Integration */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="font-semibold">Notion Integration</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Paste your Notion internal integration secret to pull linked page content into character, location, item, and faction detail pages. Create one at{" "}
              <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                notion.so/my-integrations
              </a>
              , then share the relevant pages with it.
            </p>
          </div>

          {notionConfigured && (
            <p className="text-sm text-[var(--hp-high)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Token configured
            </p>
          )}

          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={notionConfigured ? "Replace token..." : "secret_..."}
              value={notionToken}
              onChange={(e) => setNotionToken(e.target.value)}
              className="flex-1"
            />
            <Button onClick={saveNotionToken} disabled={!notionToken.trim()} className="flex-none">
              Save
            </Button>
          </div>
        </section>
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors from tsc. Lint has a documented pre-existing baseline (6 errors/18 warnings in other files) — confirm your changes don't add to that count.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, open `http://localhost:3000/settings`.
Expected: a new "Notion Integration" section appears, paste any string and click Save, confirm "Token configured" appears and `curl http://localhost:3000/api/settings` shows `"notion_token":"configured"` (not the raw value).

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/api/settings/route.ts app/settings/page.tsx
git commit -m "feat: add Notion integration token to settings"
```

---

## Task 2: Notion client utility

**Files:**
- Create: `lib/notion/client.ts`

- [ ] **Step 1: Write the page-ID extraction and block-fetching utility**

```typescript
// lib/notion/client.ts
import { Client } from "@notionhq/client";

const NOTION_ID_PATTERN = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

export function extractNotionPageId(url: string): string | null {
  const match = url.match(NOTION_ID_PATTERN);
  if (!match) return null;
  return match[1].replace(/-/g, "");
}

export interface NotionRichText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string | null;
}

export interface NotionBlockData {
  id: string;
  type: string;
  richText?: NotionRichText[];
  checked?: boolean;
  imageUrl?: string;
}

const SUPPORTED_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "to_do",
  "callout",
  "divider",
  "image",
]);

function mapRichText(
  richText: Array<{
    plain_text: string;
    annotations: { bold: boolean; italic: boolean; code: boolean };
    href: string | null;
  }>
): NotionRichText[] {
  return richText.map((t) => ({
    text: t.plain_text,
    bold: t.annotations.bold,
    italic: t.annotations.italic,
    code: t.annotations.code,
    href: t.href,
  }));
}

// The Notion SDK's block-children response is a union of partial/full block
// objects that's awkward to narrow generically across ~30 block types, so
// this reads the per-type payload dynamically (`block[block.type]`) rather
// than switching on every type's exact shape — matching this codebase's
// existing pragmatic approach to third-party JSON (see lib/ddb/client.ts).
export async function fetchNotionPageBlocks(pageId: string, token: string): Promise<NotionBlockData[]> {
  const notion = new Client({ auth: token });
  const blocks: NotionBlockData[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const raw of res.results) {
      const block = raw as unknown as Record<string, unknown> & { id: string; type: string };
      if (!SUPPORTED_TYPES.has(block.type)) continue;

      const data = block[block.type] as Record<string, unknown>;
      blocks.push({
        id: block.id,
        type: block.type,
        richText: Array.isArray(data.rich_text)
          ? mapRichText(data.rich_text as Parameters<typeof mapRichText>[0])
          : undefined,
        checked: block.type === "to_do" ? Boolean(data.checked) : undefined,
        imageUrl:
          block.type === "image"
            ? ((data.type === "external"
                ? (data.external as { url: string }).url
                : (data.file as { url: string }).url) ?? undefined)
            : undefined,
      });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify page-ID extraction**

Run: `node -e "const {extractNotionPageId} = require('./lib/notion/client.ts')" ` won't work directly since this is TypeScript — instead, verify via a quick throwaway script:

```bash
npx tsx -e "
import { extractNotionPageId } from './lib/notion/client';
console.log(extractNotionPageId('https://www.notion.so/My-Page-Title-abc123def4567890abc123def4567890'));
console.log(extractNotionPageId('https://www.notion.so/workspace/1a2b3c4d-5e6f-7890-abcd-ef1234567890'));
console.log(extractNotionPageId('not a notion url'));
"
```

Expected: first two calls print a 32-character lowercase hex string (dashes stripped), third prints `null`. If `tsx` isn't installed, run `npx --yes tsx -e "..."` (this will install it transiently, no need to add it as a project dependency).

- [ ] **Step 4: Commit**

```bash
git add lib/notion/client.ts
git commit -m "feat: add Notion page-ID extraction and block fetching"
```

---

## Task 3: Notion fetch API route

**Files:**
- Create: `app/api/notion/page/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/notion/page/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractNotionPageId, fetchNotionPageBlocks } from "@/lib/notion/client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Provide a Notion page url" }, { status: 400 });
  }

  const pageId = extractNotionPageId(url);
  if (!pageId) {
    return NextResponse.json({ error: "Could not find a page ID in that URL" }, { status: 400 });
  }

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) {
    return NextResponse.json(
      { error: "Add a Notion integration token in Settings to see notes here" },
      { status: 400 }
    );
  }

  try {
    const blocks = await fetchNotionPageBlocks(pageId, tokenRow.value);
    return NextResponse.json({ blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Notion page";
    const notShared = /could not find|restricted|unauthorized/i.test(message);
    return NextResponse.json(
      {
        error: notShared
          ? "This page hasn't been shared with the integration, or doesn't exist"
          : message,
      },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, then:

Run: `curl -s "http://localhost:3000/api/notion/page"`
Expected: `400` with `{"error":"Provide a Notion page url"}`.

Run: `curl -s "http://localhost:3000/api/notion/page?url=https://example.com/not-notion"`
Expected: `400` with `{"error":"Could not find a page ID in that URL"}`.

If you have NOT yet configured a real Notion token in Settings (Task 1), run:
Run: `curl -s "http://localhost:3000/api/notion/page?url=https://www.notion.so/Test-abc123def4567890abc123def4567890"`
Expected: `400` with `{"error":"Add a Notion integration token in Settings to see notes here"}`.

If you HAVE configured a real token and shared a real page with the integration, test against that real page's URL and confirm you get back `{"blocks": [...]}` with actual content. If you don't have a real Notion workspace/page available to test against in this environment, the three error-path checks above are sufficient — the happy path will be exercised manually by whoever runs this against their real Notion setup.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/notion/page/route.ts
git commit -m "feat: add Notion page content API route"
```

---

## Task 4: Notion block renderer

**Files:**
- Create: `components/glossary/NotionBlocks.tsx`

- [ ] **Step 1: Write the renderer**

```tsx
// components/glossary/NotionBlocks.tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { NotionBlockData, NotionRichText } from "@/lib/notion/client";

function RichText({ segments }: { segments: NotionRichText[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let content: React.ReactNode = s.text;
        if (s.code) content = <code className="bg-muted px-1 rounded text-xs">{content}</code>;
        if (s.bold) content = <strong>{content}</strong>;
        if (s.italic) content = <em>{content}</em>;
        if (s.href) {
          content = (
            <a href={s.href} target="_blank" rel="noreferrer" className="text-primary underline">
              {content}
            </a>
          );
        }
        return <React.Fragment key={i}>{content}</React.Fragment>;
      })}
    </>
  );
}

export function NotionBlocks({ blocks }: { blocks: NotionBlockData[] }) {
  return (
    <div className="space-y-3 text-sm">
      {blocks.map((b) => {
        switch (b.type) {
          case "paragraph":
            return b.richText && b.richText.length > 0 ? (
              <p key={b.id}>
                <RichText segments={b.richText} />
              </p>
            ) : null;
          case "heading_1":
            return (
              <h2 key={b.id} className="text-lg font-bold pt-2">
                {b.richText && <RichText segments={b.richText} />}
              </h2>
            );
          case "heading_2":
            return (
              <h3 key={b.id} className="text-base font-bold pt-2">
                {b.richText && <RichText segments={b.richText} />}
              </h3>
            );
          case "heading_3":
            return (
              <h4 key={b.id} className="text-sm font-bold pt-1">
                {b.richText && <RichText segments={b.richText} />}
              </h4>
            );
          case "bulleted_list_item":
            return (
              <li key={b.id} className="ml-4 list-disc">
                {b.richText && <RichText segments={b.richText} />}
              </li>
            );
          case "numbered_list_item":
            return (
              <li key={b.id} className="ml-4 list-decimal">
                {b.richText && <RichText segments={b.richText} />}
              </li>
            );
          case "quote":
            return (
              <blockquote key={b.id} className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
                {b.richText && <RichText segments={b.richText} />}
              </blockquote>
            );
          case "to_do":
            return (
              <div key={b.id} className="flex items-center gap-2">
                <input type="checkbox" checked={b.checked} disabled />
                <span className={cn(b.checked && "line-through text-muted-foreground")}>
                  {b.richText && <RichText segments={b.richText} />}
                </span>
              </div>
            );
          case "callout":
            return (
              <div key={b.id} className="flex items-start gap-2 rounded-lg bg-muted border border-border p-3">
                <div>{b.richText && <RichText segments={b.richText} />}</div>
              </div>
            );
          case "divider":
            return <hr key={b.id} className="border-border" />;
          case "image":
            return b.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Notion-hosted URL, not a local asset
              <img key={b.id} src={b.imageUrl} alt="" className="rounded-lg border border-border max-w-full" />
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Commit**

```bash
git add components/glossary/NotionBlocks.tsx
git commit -m "feat: add Notion block renderer component"
```

---

## Task 5: DDB character → StatBlock mapping

**Files:**
- Modify: `lib/ddb/client.ts`

- [ ] **Step 1: Add the mapping function**

Add this exported function to `lib/ddb/client.ts` (near the other exported helpers, after `fetchPublicCharacter`). First add the needed import at the top of the file if `StatBlock` isn't already imported — check the existing import line:

```typescript
import type { DDBCharacter, DDBSpell, DDBFeature, DDBAttack, StatBlock } from "@/lib/types";
```

(This import already exists in the file with `StatBlock` included — confirm before adding a duplicate import.)

Add the function:

```typescript
// Fuller mapping than AddCombatantDialog's inline version (which only needs
// name/AC/HP/stats for a quick combat add) — this one is for a character's
// own reference/detail page, so it also surfaces proficient saves, skills,
// and passive perception.
export function ddbCharacterToStatBlock(char: DDBCharacter): StatBlock {
  const classSummary = char.classes
    ?.map((c) => `${c.name}${c.subclass ? ` (${c.subclass})` : ""} ${c.level}`)
    .join(" / ");

  const savingThrows = Object.fromEntries(
    Object.entries(char.savingThrows)
      .filter(([, v]) => v.proficient)
      .map(([k, v]) => [k, v.total])
  );

  const skills = Object.fromEntries(
    Object.entries(char.skills)
      .filter(([, v]) => v.proficient || v.expertise)
      .map(([k, v]) => [k, v.total])
  );

  return {
    name: char.name,
    type: classSummary,
    subtype: char.race,
    ac: char.ac,
    acNote: char.acNote,
    hp: char.maxHp,
    hitDice: char.hitDice,
    speed: `${char.speed} ft.`,
    str: char.stats.str,
    dex: char.stats.dex,
    con: char.stats.con,
    int: char.stats.int,
    wis: char.stats.wis,
    cha: char.stats.cha,
    savingThrows: Object.keys(savingThrows).length > 0 ? savingThrows : undefined,
    skills: Object.keys(skills).length > 0 ? skills : undefined,
    senses: `passive Perception ${char.passivePerception}`,
    imageUrl: char.avatarUrl,
  };
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Manually verify against a real character**

If you have a real D&D Beyond character share URL available (from earlier testing in Settings), verify the mapping produces sane output:

```bash
npx tsx -e "
import { fetchPublicCharacter } from './lib/ddb/client';
import { ddbCharacterToStatBlock } from './lib/ddb/client';
fetchPublicCharacter('<paste a real share URL or numeric ID here>').then((char) => {
  console.log(JSON.stringify(ddbCharacterToStatBlock(char), null, 2));
});
"
```

Expected: a `StatBlock`-shaped object with sane `name`, `ac`, `hp`, ability scores, and non-empty `savingThrows`/`skills` if the character has any proficiencies. If no real D&D Beyond character is available in this environment, skip this step — `tsc` passing is sufficient confirmation the mapping is structurally correct, and it'll be exercised for real once Task 10 wires it into the UI.

- [ ] **Step 4: Commit**

```bash
git add lib/ddb/client.ts
git commit -m "feat: add DDB character to StatBlock mapping for detail pages"
```

---

## Task 6: Reverse-relationship API for Locations/Items/Factions

**Files:**
- Modify: `app/api/locations/[id]/route.ts`
- Modify: `app/api/items/[id]/route.ts`
- Modify: `app/api/factions/[id]/route.ts`

- [ ] **Step 1: Add the reverse query to Locations' GET handler**

In `app/api/locations/[id]/route.ts`, change:

```typescript
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
```

to:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locations, characterLocations, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterLocations.findMany({
    where: eq(characterLocations.locationId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });
}
```

Leave the `PATCH` and `DELETE` handlers in this file untouched.

- [ ] **Step 2: Mirror the same change for Items**

In `app/api/items/[id]/route.ts`, apply the identical pattern swapping `locations`→`items`, `characterLocations`→`characterItems`, `locationId`→`itemId`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, characterItems, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.items.findFirst({ where: eq(items.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterItems.findMany({
    where: eq(characterItems.itemId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });
}
```

- [ ] **Step 3: Mirror the same change for Factions**

In `app/api/factions/[id]/route.ts`, apply the identical pattern swapping `locations`→`factions`, `characterLocations`→`characterFactions`, `locationId`→`factionId`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factions, characterFactions, characters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.factions.findFirst({ where: eq(factions.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.query.characterFactions.findMany({
    where: eq(characterFactions.factionId, id),
  });
  const linkedCharacters =
    links.length > 0
      ? await db.query.characters.findMany({
          where: inArray(characters.id, links.map((l) => l.characterId)),
        })
      : [];

  return NextResponse.json({
    ...row,
    linkedCharacters: linkedCharacters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, then set up a real link and confirm the reverse query works:

```bash
CAMPAIGN_ID=$(curl -s http://localhost:3000/api/campaigns | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
FACTION=$(curl -s -X POST http://localhost:3000/api/factions -H "Content-Type: application/json" -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"name\":\"Verify Faction\"}")
FACTION_ID=$(echo "$FACTION" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
CHAR=$(curl -s -X POST http://localhost:3000/api/characters -H "Content-Type: application/json" -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"name\":\"Verify Character\",\"type\":\"npc\"}")
CHAR_ID=$(echo "$CHAR" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
curl -s -X PUT http://localhost:3000/api/characters/$CHAR_ID/factions -H "Content-Type: application/json" -d "{\"factionIds\":[\"$FACTION_ID\"]}"
curl -s http://localhost:3000/api/factions/$FACTION_ID
```

Expected: the final `curl` returns the faction row plus `"linkedCharacters":[{"id":"...","name":"Verify Character","type":"npc"}]`. Clean up the test faction/character afterward via `DELETE` calls.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/locations/[id]/route.ts app/api/items/[id]/route.ts app/api/factions/[id]/route.ts
git commit -m "feat: add reverse character-relationship lookups to simple entities"
```

---

## Task 7: Tabs UI component + RelatedCard component

**Files:**
- Create: `components/ui/tabs.tsx`
- Create: `components/glossary/RelatedCard.tsx`

- [ ] **Step 1: Write the Tabs wrapper**

`@radix-ui/react-tabs` is already a project dependency (listed in `package.json`) but has no wrapper component yet — add one matching the existing `components/ui/*` forwardRef pattern (compare `components/ui/dialog.tsx`):

```tsx
// components/ui/tabs.tsx
"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground",
      "data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn(className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

- [ ] **Step 2: Write the RelatedCard component**

```tsx
// components/glossary/RelatedCard.tsx
import Link from "next/link";

interface RelatedCardProps {
  href: string;
  name: string;
  type: string;
}

export function RelatedCard({ href, name, type }: RelatedCardProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors text-sm"
    >
      <span className="font-medium">{name}</span>
      <span className="text-xs text-muted-foreground">{type}</span>
    </Link>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 4: Commit**

```bash
git add components/ui/tabs.tsx components/glossary/RelatedCard.tsx
git commit -m "feat: add Tabs UI primitive and RelatedCard component"
```

---

## Task 8: Extract SimpleEntityFormDialog

**Files:**
- Create: `components/entities/SimpleEntityFormDialog.tsx`
- Modify: `components/entities/SimpleEntityManager.tsx`

- [ ] **Step 1: Write the extracted dialog**

This pulls the dialog that currently lives inline inside `SimpleEntityManager` out into its own component, so both the list page and the new detail page (Task 9) can render it. State initializes directly from props (no reset-on-open effect) — the parent supplies a `key` to force a remount when switching between entities, avoiding the `react-hooks/set-state-in-effect` lint issue this codebase hit earlier with an effect-based reset approach.

```tsx
// components/entities/SimpleEntityFormDialog.tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface SimpleEntity {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
}

interface SimpleEntityFormDialogProps {
  open: boolean;
  onClose: () => void;
  resourcePath: "locations" | "items" | "factions";
  label: string;
  campaignId: string;
  entity?: SimpleEntity | null;
  onSaved: () => void;
}

export function SimpleEntityFormDialog({
  open,
  onClose,
  resourcePath,
  label,
  campaignId,
  entity,
  onSaved,
}: SimpleEntityFormDialogProps) {
  const [name, setName] = useState(entity?.name ?? "");
  const [description, setDescription] = useState(entity?.description ?? "");
  const [notionUrl, setNotionUrl] = useState(entity?.notionUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !campaignId) return;
    setSaving(true);
    try {
      const payload = {
        campaignId,
        name: name.trim(),
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
      };
      if (entity) {
        await fetch(`/api/${resourcePath}/${entity.id}`, {
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
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entity ? `Edit ${label.replace(/s$/, "")}` : `New ${label.replace(/s$/, "")}`}</DialogTitle>
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
          <Input
            placeholder="Notion page URL (optional)"
            value={notionUrl}
            onChange={(e) => setNotionUrl(e.target.value)}
          />
          <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : entity ? "Save Changes" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update SimpleEntityManager to use it, remove the inline dialog**

Replace the entire contents of `components/entities/SimpleEntityManager.tsx` with:

```tsx
// components/entities/SimpleEntityManager.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { SimpleEntityFormDialog, type SimpleEntity } from "@/components/entities/SimpleEntityFormDialog";

interface SimpleEntityManagerProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

export function SimpleEntityManager({ resourcePath, label, icon: Icon }: SimpleEntityManagerProps) {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const [entities, setEntities] = useState<SimpleEntity[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/${resourcePath}?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setEntities);
  }, [activeCampaignId, resourcePath]);

  useEffect(() => {
    load();
  }, [load]);

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
        <h1 className="font-bold text-lg flex items-center gap-2"><Icon className="w-4 h-4" /> {label}</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
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
            onClick={() => router.push(`/${resourcePath}/${e.id}`)}
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

      <SimpleEntityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={null}
        onSaved={load}
      />
    </div>
  );
}
```

Note this removes `useSearchParams`, `Suspense`, and the `?open=` deep-link effect entirely — no longer needed since list rows now navigate straight to a real detail page (Task 9) instead of opening this dialog.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues. (`tsc` will fail if `app/locations/page.tsx`, `app/items/page.tsx`, or `app/factions/page.tsx` still reference anything removed from `SimpleEntityManager`'s props — they shouldn't, since its public props (`resourcePath`/`label`/`icon`) are unchanged.)

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open `/locations`. Confirm "New Location" still opens a working create dialog and creates a location. Confirm clicking an existing row now navigates to `/locations/<id>` — this will 404 until Task 9 lands, which is expected at this point in the plan. Confirm the hover-delete button still works from the list.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/entities/SimpleEntityFormDialog.tsx components/entities/SimpleEntityManager.tsx
git commit -m "refactor: extract SimpleEntityFormDialog from SimpleEntityManager"
```

---

## Task 9: Simple entity detail pages (Locations/Items/Factions)

**Files:**
- Create: `components/glossary/SimpleEntityDetail.tsx`
- Create: `app/locations/[id]/page.tsx`
- Create: `app/items/[id]/page.tsx`
- Create: `app/factions/[id]/page.tsx`

- [ ] **Step 1: Write the shared detail component**

```tsx
// components/glossary/SimpleEntityDetail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2, type LucideIcon } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { SimpleEntityFormDialog } from "@/components/entities/SimpleEntityFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { NotionBlockData } from "@/lib/notion/client";

interface SimpleEntityDetailData {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
  linkedCharacters: { id: string; name: string; type: string }[];
}

interface SimpleEntityDetailProps {
  resourcePath: "locations" | "items" | "factions";
  label: string;
  icon: LucideIcon;
}

export function SimpleEntityDetail({ resourcePath, label, icon: Icon }: SimpleEntityDetailProps) {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
  const [entity, setEntity] = useState<SimpleEntityDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const [notionBlocks, setNotionBlocks] = useState<NotionBlockData[] | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionLoading, setNotionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${resourcePath}/${id}`);
      setEntity(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [resourcePath, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!entity?.notionUrl) return;
    setNotionLoading(true);
    setNotionError(null);
    fetch(`/api/notion/page?url=${encodeURIComponent(entity.notionUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setNotionError(data.error);
        else setNotionBlocks(data.blocks);
      })
      .catch(() => setNotionError("Failed to fetch Notion page"))
      .finally(() => setNotionLoading(false));
  }, [entity?.notionUrl]);

  async function remove() {
    if (!confirm(`Delete this ${label.toLowerCase().replace(/s$/, "")}?`)) return;
    await fetch(`/api/${resourcePath}/${id}`, { method: "DELETE" });
    router.push(`/${resourcePath}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">{label.replace(/s$/, "")} not found.</p>
        <Button onClick={() => router.push(`/${resourcePath}`)}>Back to {label}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <Link
        href={`/${resourcePath}`}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {label}
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" /> {entity.name}
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notion">Notion Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {entity.description && <p className="text-sm text-muted-foreground">{entity.description}</p>}

          {entity.linkedCharacters.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linked Characters
              </h3>
              <div className="flex flex-wrap gap-2">
                {entity.linkedCharacters.map((c) => (
                  <RelatedCard
                    key={c.id}
                    href={`/characters/${c.id}`}
                    name={c.name}
                    type={c.type === "pc" ? "PC" : "NPC"}
                  />
                ))}
              </div>
            </div>
          )}

          {!entity.description && entity.linkedCharacters.length === 0 && (
            <p className="text-sm text-muted-foreground">No description or linked characters yet.</p>
          )}
        </TabsContent>

        <TabsContent value="notion" className="pt-4">
          {!entity.notionUrl && (
            <p className="text-sm text-muted-foreground">No Notion page linked. Add one via Edit.</p>
          )}
          {entity.notionUrl && notionLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Notion page...
            </div>
          )}
          {entity.notionUrl && notionError && <p className="text-sm text-destructive">{notionError}</p>}
          {entity.notionUrl && notionBlocks && (
            <div className="space-y-3">
              <a
                href={entity.notionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                View in Notion ↗
              </a>
              <NotionBlocks blocks={notionBlocks} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SimpleEntityFormDialog
        key={entity.id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        resourcePath={resourcePath}
        label={label}
        campaignId={activeCampaignId ?? ""}
        entity={entity}
        onSaved={load}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the three page wrappers**

```tsx
// app/locations/[id]/page.tsx
"use client";

import { MapPin } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function LocationDetailPage() {
  return <SimpleEntityDetail resourcePath="locations" label="Locations" icon={MapPin} />;
}
```

```tsx
// app/items/[id]/page.tsx
"use client";

import { Package } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function ItemDetailPage() {
  return <SimpleEntityDetail resourcePath="items" label="Items" icon={Package} />;
}
```

```tsx
// app/factions/[id]/page.tsx
"use client";

import { Shield } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function FactionDetailPage() {
  return <SimpleEntityDetail resourcePath="factions" label="Factions" icon={Shield} />;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`. Create a Location, click it from `/locations` — confirm it now navigates to `/locations/<id>` and renders the Overview tab (description, empty "Linked Characters" unless you have a linked character from Task 6's verification), and the Notion Notes tab (empty state if no `notionUrl` set, or the configured error/content state if one is set). Click Edit, confirm the dialog opens pre-filled and saves correctly, confirm the page reflects the update. Click Delete, confirm it navigates back to `/locations` and the entity is gone. Repeat a quick spot-check for `/items/[id]` and `/factions/[id]`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/glossary/SimpleEntityDetail.tsx app/locations/[id] app/items/[id] app/factions/[id]
git commit -m "feat: add detail pages for locations, items, and factions"
```

---

## Task 10: Character detail page

**Files:**
- Create: `app/characters/[id]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/characters/[id]/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pencil, Trash2, Loader2 } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { RelatedCard } from "@/components/glossary/RelatedCard";
import { StatBlock } from "@/components/tracker/StatBlock";
import { CharacterFormDialog, type CharacterWithLinks } from "@/components/entities/CharacterFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { ddbCharacterToStatBlock } from "@/lib/ddb/client";
import type { NotionBlockData } from "@/lib/notion/client";
import type { StatBlock as StatBlockType, DDBCharacter } from "@/lib/types";

interface RelatedEntity {
  id: string;
  name: string;
}

export default function CharacterDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();
  const [character, setCharacter] = useState<CharacterWithLinks | null>(null);
  const [factions, setFactions] = useState<RelatedEntity[]>([]);
  const [locations, setLocations] = useState<RelatedEntity[]>([]);
  const [items, setItems] = useState<RelatedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const [notionBlocks, setNotionBlocks] = useState<NotionBlockData[] | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionLoading, setNotionLoading] = useState(false);

  const [ddbCharacter, setDdbCharacter] = useState<DDBCharacter | null>(null);
  const [ddbError, setDdbError] = useState<string | null>(null);
  const [ddbLoading, setDdbLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/characters/${id}`);
      if (!res.ok) {
        setCharacter(null);
        return;
      }
      const data: CharacterWithLinks = await res.json();
      setCharacter(data);

      const [f, l, i] = await Promise.all([
        Promise.all(data.factionIds.map((id) => fetch(`/api/factions/${id}`).then((r) => r.json()))),
        Promise.all(data.locationIds.map((id) => fetch(`/api/locations/${id}`).then((r) => r.json()))),
        Promise.all(data.itemIds.map((id) => fetch(`/api/items/${id}`).then((r) => r.json()))),
      ]);
      setFactions(f);
      setLocations(l);
      setItems(i);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!character?.notionUrl) return;
    setNotionLoading(true);
    setNotionError(null);
    fetch(`/api/notion/page?url=${encodeURIComponent(character.notionUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setNotionError(data.error);
        else setNotionBlocks(data.blocks);
      })
      .catch(() => setNotionError("Failed to fetch Notion page"))
      .finally(() => setNotionLoading(false));
  }, [character?.notionUrl]);

  useEffect(() => {
    if (!character?.ddbCharacterId) return;
    setDdbLoading(true);
    setDdbError(null);
    fetch(`/api/ddb/characters/${character.ddbCharacterId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setDdbError(data.error);
        else setDdbCharacter(data.character);
      })
      .catch(() => setDdbError("Failed to fetch D&D Beyond character"))
      .finally(() => setDdbLoading(false));
  }, [character?.ddbCharacterId]);

  async function remove() {
    if (!confirm("Delete this character?")) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    router.push("/characters");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Character not found.</p>
        <Button onClick={() => router.push("/characters")}>Back to Characters</Button>
      </div>
    );
  }

  const ddbStatBlock: StatBlockType | null = ddbCharacter ? ddbCharacterToStatBlock(ddbCharacter) : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <Link
        href="/characters"
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Characters
      </Link>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{character.name}</h1>
          <Badge variant={character.type === "pc" ? "hp" : "outline"} className="capitalize">
            {character.type}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notion">Notion Notes</TabsTrigger>
          <TabsTrigger value="ddb">D&D Beyond</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {character.description && <p className="text-sm text-muted-foreground">{character.description}</p>}

          {(factions.length > 0 || locations.length > 0 || items.length > 0) && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Related</h3>
              <div className="flex flex-wrap gap-2">
                {factions.map((f) => (
                  <RelatedCard key={f.id} href={`/factions/${f.id}`} name={f.name} type="Faction" />
                ))}
                {locations.map((l) => (
                  <RelatedCard key={l.id} href={`/locations/${l.id}`} name={l.name} type="Location" />
                ))}
                {items.map((i) => (
                  <RelatedCard key={i.id} href={`/items/${i.id}`} name={i.name} type="Item" />
                ))}
              </div>
            </div>
          )}

          {!character.description && factions.length === 0 && locations.length === 0 && items.length === 0 && (
            <p className="text-sm text-muted-foreground">No description or relationships yet.</p>
          )}
        </TabsContent>

        <TabsContent value="notion" className="pt-4">
          {!character.notionUrl && (
            <p className="text-sm text-muted-foreground">No Notion page linked. Add one via Edit.</p>
          )}
          {character.notionUrl && notionLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Notion page...
            </div>
          )}
          {character.notionUrl && notionError && <p className="text-sm text-destructive">{notionError}</p>}
          {character.notionUrl && notionBlocks && (
            <div className="space-y-3">
              <a
                href={character.notionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                View in Notion ↗
              </a>
              <NotionBlocks blocks={notionBlocks} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="ddb" className="pt-4">
          {!character.ddbCharacterId && (
            <p className="text-sm text-muted-foreground">No D&D Beyond character linked. Add one via Edit.</p>
          )}
          {character.ddbCharacterId && ddbLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading D&D Beyond stats...
            </div>
          )}
          {character.ddbCharacterId && ddbError && <p className="text-sm text-destructive">{ddbError}</p>}
          {character.ddbCharacterId && ddbStatBlock && (
            <div className="border border-border rounded-xl h-[500px]">
              <StatBlock statBlock={ddbStatBlock} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CharacterFormDialog
        key={character.id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        campaignId={activeCampaignId ?? ""}
        character={character}
        onSaved={load}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Create a character with a description and at least one faction/location/item link. Click it from `/characters` — confirm it navigates to `/characters/<id>` and shows: Overview tab with description + Related cards (click one, confirm it navigates to that entity's own detail page); Notion Notes tab (empty state, or configured behavior if you've set a `notionUrl` and Notion token); D&D Beyond tab (empty state, or a real rendered `StatBlock` if you set a `ddbCharacterId` on a character — you can get a real DDB ID from a D&D Beyond share URL configured in Settings). Click Edit, confirm the dialog opens pre-filled with relationship checkboxes correctly checked, save, confirm changes reflect. Click Delete, confirm navigation back to `/characters`.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/characters/[id]
git commit -m "feat: add character detail page with Notion and D&D Beyond tabs"
```

---

## Task 11: Update list page navigation (Characters)

**Files:**
- Modify: `app/characters/page.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `app/characters/page.tsx` (dropping the `?open=` deep-link effect, `useSearchParams`, and the `Suspense` wrapper entirely — no longer needed since rows now navigate to the real detail page from Task 10):

```tsx
// app/characters/page.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { CharacterFormDialog } from "@/components/entities/CharacterFormDialog";
import type { Character } from "@/lib/db/schema";

export default function CharactersPage() {
  const router = useRouter();
  const { activeCampaignId } = useCampaignStore();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/characters?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then(setCharacters);
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

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
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
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
            onClick={() => router.push(`/characters/${c.id}`)}
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
        character={null}
        onSaved={load}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, open `/characters`. Confirm "New Character" still opens a working create dialog. Confirm clicking an existing row navigates to `/characters/<id>` (Task 10's page) instead of opening a dialog. Confirm hover-delete still works from the list.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/characters/page.tsx
git commit -m "feat: navigate to character detail page from the list instead of a dialog"
```

---

## Task 12: Update search result links

**Files:**
- Modify: `app/api/search/route.ts`

- [ ] **Step 1: Change the generated hrefs**

In `app/api/search/route.ts`, change:

```typescript
  const results = [
    ...chars.map((c) => ({ id: c.id, name: c.name, type: "character", href: `/characters?open=${c.id}` })),
    ...locs.map((l) => ({ id: l.id, name: l.name, type: "location", href: `/locations?open=${l.id}` })),
    ...itms.map((i) => ({ id: i.id, name: i.name, type: "item", href: `/items?open=${i.id}` })),
    ...facs.map((f) => ({ id: f.id, name: f.name, type: "faction", href: `/factions?open=${f.id}` })),
    ...encs.map((e) => ({ id: e.id, name: e.name, type: "encounter", href: `/encounters/${e.id}` })),
  ];
```

to:

```typescript
  const results = [
    ...chars.map((c) => ({ id: c.id, name: c.name, type: "character", href: `/characters/${c.id}` })),
    ...locs.map((l) => ({ id: l.id, name: l.name, type: "location", href: `/locations/${l.id}` })),
    ...itms.map((i) => ({ id: i.id, name: i.name, type: "item", href: `/items/${i.id}` })),
    ...facs.map((f) => ({ id: f.id, name: f.name, type: "faction", href: `/factions/${f.id}` })),
    ...encs.map((e) => ({ id: e.id, name: e.name, type: "encounter", href: `/encounters/${e.id}` })),
  ];
```

No changes needed to `components/shell/CommandPalette.tsx` — it already navigates via `router.push(href)` generically, whatever the href shape is.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new lint issues.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, press ⌘K, search for a character/location/item/faction you've created, click it — confirm it navigates directly to `/characters/<id>` (or the matching detail route) and the detail page loads correctly, not a 404 and not the old `?open=` dialog behavior.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/search/route.ts
git commit -m "feat: point command palette results at detail pages"
```

---

## Task 13: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Fresh production build**

Run: `rm -f encounter-tracker.db* && npm install && npm run build && npm run start`
Expected: build succeeds (no Suspense-boundary errors — this plan avoided introducing any new `useSearchParams()` usage, and removed the two existing ones from the list pages), server starts on port 3000 without errors.

- [ ] **Step 2: Walk the golden path in a browser**

1. In Settings, add a Notion integration token (a real one if available; any string otherwise, to exercise the "configured" state).
2. Create a Faction, a Location, and an Item, each with a `notionUrl` pointing at a real Notion page shared with your integration (if you have one) — otherwise leave `notionUrl` blank and just confirm the empty state renders on their detail pages.
3. Create a Character, link it to the Faction/Location/Item just created, optionally set a real `ddbCharacterId` (the numeric ID from a D&D Beyond share URL).
4. Open the Character's detail page: confirm Overview shows the Related cards linking to the Faction/Location/Item detail pages; confirm clicking one navigates correctly and shows that entity's own "Linked Characters" section including this character; confirm the Notion Notes tab and D&D Beyond tab behave correctly (real content if configured, sensible empty/error states otherwise).
5. Press ⌘K, search for the character by name, click the result — confirm it lands directly on the detail page.
6. From the Character detail page, click Edit, change the description, save — confirm the change persists on reload.
7. From the Character detail page, click Delete — confirm it navigates back to `/characters` and the character is gone.

Check the browser console for errors and the Network tab for unexpected 404s at every step.

- [ ] **Step 3: Stop the server — no commit for this task (verification only)**

Run: stop the dev/prod server, confirm port 3000 is free.
