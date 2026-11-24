# Encounter Tracker Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the encounter tracker readable mid-fight — an always-on stat block pane, bigger combatant rows, distinguishable duplicate creatures — and give the creature/NPC library a page where sheets can be viewed and edited without touching JSON.

**Architecture:** Four additive SQLite columns carry the new state. All decision logic lands in pure `lib/` modules with their own tests (vitest runs node-only, `.ts` only, so components get no unit tests); the React components stay thin consumers. One `StatSheetEditor` component is hosted in three places — the Bestiary page column, a dialog from Add Combatant, and a dialog from the pane.

**Tech Stack:** Next.js (App Router), React, TypeScript, Zustand, Drizzle + better-sqlite3, Tailwind, vitest, sharp (already a dependency, used by maps storage).

**Spec:** [docs/superpowers/specs/2026-11-24-encounter-tracker-tweaks-design.md](../specs/2026-11-24-encounter-tracker-tweaks-design.md)

## Global Constraints

- **This is not the Next.js in your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (per `AGENTS.md`). Heed deprecation notices.
- **Tests are node-environment `.ts` only.** `vitest.config.ts` includes `lib/**/*.test.ts` and `components/**/*.test.ts`. No `.tsx` test will run — put logic worth testing in a `.ts` module.
- **Migrations are hand-written and idempotent:** `addColumnIfMissing(table, column, definition)` at the bottom of `lib/db/migrate.ts`, mirrored by the Drizzle column in `lib/db/schema.ts`. Do not introduce drizzle-kit generated migrations.
- **The pane stays `w-80`.** The combatant row targets ~86px tall.
- **The library is global** — no campaign scoping, relations or archive state on `character_library`.
- **Flat `combatants` columns (`ac`, `hp_max`, `speed`) are the live combat truth**; `statBlock` is reference text. An editor save writes both. Current HP is never written into `statBlock.hp`.
- **A token colour beats a sheet-authored colour** in `combatants.color`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

Input classes the spec implies but no task's own tests would otherwise exercise, most likely to bite first. Each has a test added to the task that owns the code.

1. **A library entry deleted while a combatant built from it sits in a saved encounter** — the portrait must fall back to the type icon and "Save to library" must not offer to write to a missing row. *(Tasks 4, 10)*
2. **A sheet with no `statBlock` at all** — an NPC entry is legal with just `name`/`type`/`ac`/`hpMax`. The editor's Stats and Actions tabs and the reverse converter must handle its absence rather than reading through null. *(Task 3)*
3. **Removing a middle member of a duplicate group** — killing Goblin 2 of 3 must not renumber or recolour the survivors. *(Task 2)*
4. **A duplicate group bigger than the palette** — 12 goblins must keep getting colours, wrapping rather than yielding `undefined`. *(Task 2)*
5. **Max HP edited to 0, or a combatant with `hpMax` 0** — the clamp must not produce negative or `NaN` current HP, and the row's HP strip already guards on `hpMax > 0`. *(Task 3)*

---

### Task 1: Schema and persistence plumbing

**Files:**
- Modify: `lib/db/schema.ts` (add columns to `combatants`, `characters`, `characterLibrary`)
- Modify: `lib/db/migrate.ts` (idempotent `addColumnIfMissing` calls, at the bottom beside the existing ones)
- Modify: `lib/types.ts` (`CombatantWithParsed`)
- Modify: `lib/encounters/save.ts` (`CombatantSave`, `combatantPatch`)
- Modify: `lib/encounters/payload.ts` (`combatSnapshot`)
- Modify: `app/api/encounters/[id]/combatants/route.ts` (POST insert values)
- Test: `lib/encounters/payload.test.ts`, `lib/encounters/save.test.ts` (both exist — extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `combatants.label: string | null`, `combatants.libraryId: string | null`, `characters.statSheetId: string | null`, `characterLibrary.imagePath: string | null` as Drizzle columns; `CombatantWithParsed.label` and `.libraryId`; `CombatantSave` accepting `label`, `libraryId`, `color`.

- [ ] **Step 1: Write the failing tests**

In `lib/encounters/payload.test.ts` — `label` and `color` change mid-fight, so they must ride in the slim snapshot; `libraryId` must not (it never changes after the add, and the snapshot is budget-limited):

```ts
it("carries label and color in the combat snapshot", () => {
  const snap = combatSnapshot(encounterWith({ label: "on the roof", color: "#c0392b" }));
  expect(snap.combatants[0]).toMatchObject({ label: "on the roof", color: "#c0392b" });
});

it("leaves libraryId out of the combat snapshot", () => {
  const snap = combatSnapshot(encounterWith({ libraryId: "lib-1" }));
  expect(snap.combatants[0]).not.toHaveProperty("libraryId");
});
```

In `lib/encounters/save.test.ts`, following that file's existing round-trip style: saving a payload carrying `label`, `libraryId` and `color` persists all three; and a payload omitting `label` leaves an existing label untouched (the partial-save guarantee `combatantPatch` exists to provide).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/encounters`
Expected: FAIL — `label` absent from the snapshot, unknown column in the save.

- [ ] **Step 3: Add the four columns**

In `lib/db/schema.ts`: `label: text("label")` and `libraryId: text("library_id").references(() => characterLibrary.id)` on `combatants`; `statSheetId: text("stat_sheet_id").references(() => characterLibrary.id)` on `characters`; `imagePath: text("image_path")` on `characterLibrary`.

In `lib/db/migrate.ts`, beside the existing additive calls:

```ts
addColumnIfMissing("combatants", "label", "TEXT");
addColumnIfMissing("combatants", "library_id", "TEXT REFERENCES character_library(id)");
addColumnIfMissing("characters", "stat_sheet_id", "TEXT REFERENCES character_library(id)");
addColumnIfMissing("character_library", "image_path", "TEXT");
```

`characterLibrary` is declared after `combatants` in `schema.ts`; use a callback reference as the existing `campaignId` column does to avoid the use-before-declaration.

- [ ] **Step 4: Thread the fields through**

Add `label: string | null` and `libraryId: string | null` to `CombatantWithParsed` in `lib/types.ts`. Add `label`, `libraryId` to `CombatantSave` in `lib/encounters/save.ts` and the matching `if (c.x !== undefined) patch.x = c.x` lines to `combatantPatch`. Add `label` and `color` to the `combatSnapshot` mapping in `lib/encounters/payload.ts`. Add `label: body.label ?? null` and `libraryId: body.libraryId ?? null` to the POST insert in `app/api/encounters/[id]/combatants/route.ts`.

Every object literal that builds a `CombatantWithParsed` now needs the two new keys — the compiler will name them (four sites in `AddCombatantDialog.tsx`, one in `lib/character-schema.ts`). Set both to `null` for now; later tasks fill them.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run lib/encounters && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db lib/types.ts lib/encounters app/api/encounters components/tracker lib/character-schema.ts
git commit -m "feat: add label, library link, sheet link and portrait columns"
```

---

### Task 2: Duplicate grouping, ordinals and token colours

**Files:**
- Create: `lib/encounters/duplicates.ts`
- Test: `lib/encounters/duplicates.test.ts`

**Interfaces:**
- Consumes: `CombatantWithParsed` from `lib/types.ts`.
- Produces:
  - `TOKEN_PALETTE: readonly string[]` — the ordered colour list.
  - `sourceKeyOf(c: Pick<CombatantWithParsed, "monsterSlug" | "characterId" | "name">): string` — `monsterSlug`, else `characterId`, else the base name.
  - `baseName(name: string): string` — the name with a trailing ordinal stripped (`"Goblin 2"` → `"Goblin"`).
  - `isRenamedByHand(currentName: string, sourceName: string): boolean`
  - `duplicateGroups(combatants: CombatantWithParsed[]): Map<string, CombatantWithParsed[]>` — only groups of 2+.
  - `tokenIndexOf(combatants: CombatantWithParsed[], id: string): number | null` — the badge number, or `null` when not in a duplicate group.
  - `tokenIndices(combatants: CombatantWithParsed[]): Map<string, number>` — every duplicate's badge number in one pass, so a list render computes this once instead of per row.
  - `planAdd(existing: CombatantWithParsed[], incoming: { name: string; sourceKey: string; sourceName: string }): { name: string; color: string | null; updateFirst: { id: string; name: string | null; color: string } | null }` — what the add path applies. `color` is `null` for a lone first copy, which keeps whatever colour its sheet supplied. `updateFirst` carries both halves of what happens to copy #1 when a group forms: `name` is the retroactive `"<source> 1"` rename, or `null` when the DM has renamed it by hand and it must keep that name; `color` is the token colour, which copy #1 always receives once a group exists, hand-renamed or not.

- [ ] **Step 1: Write the failing tests**

```ts
describe("sourceKeyOf", () => {
  it("prefers monsterSlug, then characterId, then the base name", () => { /* three cases */ });
});

describe("baseName", () => {
  it("strips a trailing ordinal", () => expect(baseName("Goblin 2")).toBe("Goblin"));
  it("leaves a name that merely ends in a word alone", () => expect(baseName("Ogre")).toBe("Ogre"));
  it("keeps a numeral that is part of the name", () => expect(baseName("Zone 9 Sentinel")).toBe("Zone 9 Sentinel"));
});

describe("duplicateGroups", () => {
  it("excludes a lone combatant", () => { /* one goblin, one ogre → empty map */ });
  it("groups two combatants sharing a monsterSlug", () => { /* ... */ });
  it("keeps two NPCs with different characterIds apart even from one sheet", () => { /* same name, different characterId → no group */ });
});

describe("tokenIndexOf", () => {
  it("returns null for a lone combatant", () => { /* ... */ });
  it("numbers group members from 1 in sortOrder", () => { /* ... */ });
  // Review Focus 3
  it("does not renumber survivors when a middle member is removed", () => {
    // goblins 1,2,3 → remove #2 → the remaining two keep indices 1 and 3
  });
});

describe("planAdd", () => {
  it("leaves the first copy unnumbered", () => { /* no existing match → name "Goblin", renameFirst null */ });
  it("numbers the second copy and renames the first", () => {
    // renameFirst.name === "Goblin 1", returned name === "Goblin 2"
  });
  it("leaves a hand-renamed first copy alone but still numbers the newcomer", () => {
    // existing "Grik" (slug goblin) → renameFirst null, name "Goblin 2"
  });
  it("assigns distinct palette colours to each copy", () => { /* ... */ });
  // Review Focus 4
  it("wraps the palette for a group larger than it", () => {
    // 12 copies with an 8-colour palette → every colour defined, no undefined
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/encounters/duplicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/encounters/duplicates.ts`**

`tokenIndexOf` numbers by position within the group sorted by `sortOrder`, **derived from the surviving members' original ordinals** so a removal does not reshuffle — read the trailing ordinal from the name when there is one, and fall back to position when there is not. Palette colours are assigned by `(index - 1) % TOKEN_PALETTE.length`.

`TOKEN_PALETTE` is 8 hex colours that read as distinct in the dark theme and give the badge's dark text enough contrast. They must not read as health (`--hp-high` green, `--hp-med` amber, `--hp-low` red) or as the `--initiative` gold — so no green, no amber, no red, no gold. Blues, violets, cyans, pinks, teals.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/encounters/duplicates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/encounters/duplicates.ts lib/encounters/duplicates.test.ts
git commit -m "feat: duplicate grouping, ordinals and token colours"
```

---

### Task 3: Sheet conversion and edit-apply logic

**Files:**
- Modify: `lib/character-schema.ts` (`CharacterUploadSchema.notes`, `statBlockToUpload`, `characterUploadToCombatant` overrides)
- Create: `lib/library/sheet-form.ts`
- Test: `lib/library/sheet-form.test.ts`

**Interfaces:**
- Consumes: `CharacterUploadSchema`, `characterUploadToCombatant`, `validateCharacterUpload` from `lib/character-schema.ts`; `CombatantWithParsed`, `StatBlock` from `lib/types.ts`.
- Produces:
  - `CharacterUploadSchema.notes?: string` — sheet prep text, distinct from `combatants.notes`.
  - `statBlockToUpload(c: Pick<CombatantWithParsed, "name" | "type" | "ac" | "hpMax" | "speed" | "initiativeBonus" | "playerName" | "avatarUrl" | "color" | "statBlock">): CharacterUploadSchema` — the reverse of `characterUploadToCombatant`, in `lib/character-schema.ts` beside its forward twin.
  - `applySheetEdits(c: CombatantWithParsed, sheet: CharacterUploadSchema): Partial<CombatantWithParsed>` — the fields an editor save writes to a combatant, honouring the field-authority rules.
  - `characterUploadToCombatant(data, encounterId, overrides?: { name?: string; characterId?: string | null; libraryId?: string | null; avatarUrl?: string | null })` — the third parameter is new.

- [ ] **Step 1: Write the failing tests**

```ts
describe("statBlockToUpload", () => {
  it("round-trips through characterUploadToCombatant unchanged", () => {
    const back = statBlockToUpload(characterUploadToCombatant(EXAMPLE_CHARACTER_JSON, "enc-1"));
    expect(validateCharacterUpload(back).valid).toBe(true);
    expect(back).toMatchObject({ name: ..., ac: ..., hpMax: ..., /* spec's example values */ });
  });
  // Review Focus 2
  it("handles a combatant with no statBlock", () => {
    // a bare NPC: name/type/ac/hpMax only → valid upload, statBlock undefined, no throw
  });
});

describe("applySheetEdits", () => {
  it("writes AC to both the flat column and the stat block", () => {
    // sheet.ac 18 → { ac: 18, statBlock: objectContaining({ ac: 18 }) }
  });
  it("clamps current HP when max HP drops below it", () => {
    // 50/59 edited to max 40 → { hpMax: 40, hpCurrent: 40 }
  });
  it("leaves current HP alone when max HP still exceeds it", () => {
    // 31/59 edited to max 40 → { hpMax: 40, hpCurrent: 31 }
  });
  it("never writes current HP into the stat block", () => {
    // statBlock.hp stays the maximum, not hpCurrent
  });
  // Review Focus 5
  it("floors a zero or negative max HP at zero without NaN", () => {
    // max 0 → hpMax 0, hpCurrent 0; max -5 → the same
  });
});

describe("characterUploadToCombatant overrides", () => {
  it("lets the entity's name and ids win over the sheet's", () => {
    // overrides { name: "Grik the Bandit", characterId: "ch-1", libraryId: "lib-1" }
    // → that name, those ids, the sheet's ac/hpMax/statBlock
  });
  it("lets an uploaded portrait's URL win over the sheet's imageUrl", () => {
    // overrides { avatarUrl: "/api/library/lib-1/image" } → that avatarUrl
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/library/sheet-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Add `notes?: string` to `CharacterUploadSchema` and accept it in `validateCharacterUpload` (a non-string `notes` is a warning, not an error — the validator's existing convention for optional fields). Write `statBlockToUpload` in `lib/character-schema.ts`, mapping `StatBlock` fields back to the nested `statBlock` and lifting `ac`/`hp`/`speed` to the top level; omit `statBlock` entirely when the combatant has none. Add the `overrides` parameter to `characterUploadToCombatant`, applied last so it wins.

`applySheetEdits` returns only changed fields. HP: `hpMax = Math.max(0, sheet.hpMax)`, `hpCurrent = Math.min(c.hpCurrent, hpMax)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/library && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/character-schema.ts lib/library
git commit -m "feat: reverse sheet converter and edit-apply rules"
```

---

### Task 4: Portrait storage and image API

**Files:**
- Create: `lib/library/storage.ts` (modelled on `lib/maps/storage.ts`)
- Create: `lib/library/portrait.ts`
- Create: `app/api/library/[id]/image/route.ts`
- Modify: `app/api/library/[id]/route.ts` (DELETE also removes the portrait file)
- Test: `lib/library/portrait.test.ts`

**Interfaces:**
- Consumes: `CharacterUploadSchema` from `lib/character-schema.ts`.
- Produces:
  - `saveLibraryImage(entryId: string, file: File): Promise<string>`, `readLibraryImage(imagePath: string): Promise<Buffer>` (throws ENOENT), `deleteLibraryImage(imagePath: string): Promise<void>`, `libraryImageContentType(imagePath: string): string` — all in `lib/library/storage.ts`, directory `$DATA_DIR/library/`.
  - `portraitUrl(entry: { id: string; imagePath: string | null; data: CharacterUploadSchema }): string | null` — in `lib/library/portrait.ts`.
  - `POST`, `GET`, `DELETE` at `/api/library/[id]/image`.

- [ ] **Step 1: Write the failing test**

```ts
describe("portraitUrl", () => {
  it("prefers an uploaded portrait", () =>
    expect(portraitUrl({ id: "lib-1", imagePath: "lib-1.png", data: { ...sheetWithImageUrl } }))
      .toBe("/api/library/lib-1/image"));
  it("falls back to the sheet's remote imageUrl", () => { /* → the remote URL */ });
  it("returns null when there is neither", () => { /* → null */ });
  // Review Focus 1
  it("returns null for an entry whose sheet and upload are both gone", () => {
    // imagePath null, statBlock undefined → null, so the caller shows the type icon
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/library/portrait.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage and resolution**

`lib/library/storage.ts` mirrors `lib/maps/storage.ts` exactly in shape — same `DATA_DIR` derivation from `process.env.DB_PATH`, same extension sanitising, same content-type switch — with `LIBRARY_DIR = path.join(DATA_DIR, "library")`. No tiling; a single file per entry. Reuse `sharp` only if you downscale; a plain write is acceptable.

`portraitUrl` returns `/api/library/${id}/image` when `imagePath` is set, else `data.statBlock?.imageUrl ?? data.avatarUrl ?? null`.

- [ ] **Step 4: Implement the routes**

`POST /api/library/[id]/image` reads a multipart form (`image`), 400s on a missing or empty file, writes via `saveLibraryImage`, sets `image_path`, returns `{ imagePath }`. `GET` serves the bytes with `libraryImageContentType`, 404 on ENOENT. `DELETE` removes file and column. The existing entry `DELETE` in `app/api/library/[id]/route.ts` reads the row first and calls `deleteLibraryImage` when `imagePath` is set. Follow the maps image route (`app/api/maps/[id]/image/route.ts`) for the `params: Promise<{ id: string }>` signature this Next.js version uses.

- [ ] **Step 5: Run the test and the type check**

Run: `npx vitest run lib/library && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/library app/api/library
git commit -m "feat: library portrait upload, serving and cleanup"
```

---

### Task 5: The bigger combatant row

**Files:**
- Modify: `components/tracker/CombatantCard.tsx` (the header row)
- Modify: `components/tracker/HPControls.tsx` (new `vitals` presentation)

**Interfaces:**
- Consumes: `hpColor`, `hpPercent` from `lib/types.ts`.
- Produces: `HPControls` takes `variant?: "full" | "compact" | "vitals"` (default `"full"`), replacing the current `compact?: boolean`. `CombatantCard` is its only caller, so the boolean can go rather than live alongside the new prop.

- [ ] **Step 1: Rebuild the header row as two groups**

Per spec §2. Identity group (flexes): drag handle, initiative box 54×52 (value 22px/700 tabular-nums over a 9px uppercase `init` label), portrait 48×48, name 17px/600 with the 12px type-and-player subtitle. Vitals box (fixed): one bordered container, `bg-[oklch(0.185_0.014_46)]` on `border-border`, holding AC and HP at 20px/700 tabular-nums under 9px uppercase labels with a 1px divider between, then the stacked +/− buttons (28×21).

The HP number carries `hpColor(c.hpCurrent, c.hpMax)`; the `/max` denominator stays `text-muted-foreground`. Keep the 6px HP strip above, the conditions row below, the active combatant's gold border and glow, and the dead state's grayscale and strikethrough.

- [ ] **Step 2: Add the `vitals` presentation to `HPControls`**

Replace `compact?: boolean` with `variant?: "full" | "compact" | "vitals"` and update `CombatantCard`'s two call sites (the header one becomes `variant="vitals"`, the expanded one stays `"full"`).

In the `vitals` variant: the +/− buttons apply ±1 via `updateHP`; clicking the HP number opens the existing damage/heal/set control inline (same three modes, same `applyInput`), closing on Enter, Escape or blur. The `hp-float` floater must fire from this variant — it currently renders only under `compact`, which this row stops using, so move that block somewhere both variants render it.

- [ ] **Step 3: Verify in the browser**

Start the dev server with `mcp__Claude_Browser__preview_start`, open an encounter with a PC, a monster and a creature at low HP. Confirm: row ≈86px; AC and HP legible at a glance inside one box; the HP number tinted by health; ±1 works; clicking the number lets you type 14 damage and Enter applies it; the floating damage number appears; the active row still glows; a dead combatant still greys out. Screenshot for the hand-off.

- [ ] **Step 4: Commit**

```bash
git add components/tracker/CombatantCard.tsx components/tracker/HPControls.tsx
git commit -m "feat: larger combatant row with a grouped vitals box"
```

---

### Task 6: Duplicate badges, stripes and labels

**Files:**
- Modify: `components/tracker/CombatantCard.tsx` (badge, left stripe, label chip)
- Modify: `components/tracker/AddCombatantDialog.tsx` (all add paths)
- Modify: `lib/store/encounter-store.ts` (`setLabel`)

**Interfaces:**
- Consumes: `planAdd`, `tokenIndices`, `sourceKeyOf` from `lib/encounters/duplicates.ts` (Task 2).
- Produces: `useEncounterStore().setLabel(combatantId: string, label: string)` — marks dirty like `setNotes`.

- [ ] **Step 1: Render the token and the label**

In `InitiativeTracker`, compute `tokenIndices(encounter.combatants)` once and pass each card its own number. In `CombatantCard`: when that number is non-null, draw the numbered badge (21px, bottom-right of the portrait, `ring-2 ring-card`, background `c.color`) and the 4px full-height stripe down the card's left edge in `c.color`. When it is null, draw the stripe only if `c.color` is set (a sheet-authored colour) and no badge.

Add the label chip to the subtitle line: `c.label` in a dashed-border chip, or a muted `+ label` affordance when empty; clicking either opens an inline input committing to `setLabel` on Enter or blur, Escape cancelling. Follow the name-edit pattern already in this file.

- [ ] **Step 2: Wire the add paths**

Every path that builds a combatant calls `planAdd` with the existing combatants and the incoming name, source key and source name, then applies the returned `name`, and applies `color` only when it is non-null (a `null` colour means this is a lone first copy, which keeps the colour its sheet supplied). When `updateFirst` is non-null, apply its `color` to the existing first copy via `updateCombatant`, and its `name` too unless that is `null` (a hand-renamed copy #1 gets the token colour but keeps its name).

The monster batch loop in `addMonster` must call `planAdd` once per iteration against the list including the copies it has already added, so a ×3 add numbers 1, 2, 3 rather than three 1s.

Two things to set on the library path while you are here, both via the new `overrides` parameter: `libraryId` (the upload path too, but only when the upload was also saved to the library, where the POST's response carries the new id), and `avatarUrl: portraitUrl(entry)` — an entry whose portrait was uploaded has its image in `image_path`, not anywhere in `data`, so without this an uploaded portrait never reaches the row.

- [ ] **Step 3: Verify in the browser**

Add one goblin — no badge, no stripe. Add a second — the first becomes "Goblin 1" with a colour, the new one "Goblin 2" with a different colour. Add an ogre ×3 in one go — numbered 1–3, three colours. Rename "Goblin 1" to "Grik", add another goblin — Grik keeps its name, the newcomer is "Goblin 3". Type a label on one, reload the page, confirm it survived. Kill the middle goblin and confirm the survivors keep their numbers.

- [ ] **Step 4: Commit**

```bash
git add components/tracker lib/store/encounter-store.ts
git commit -m "feat: distinguish duplicate creatures with token colours and labels"
```

---

### Task 7: The always-on pane

**Files:**
- Modify: `lib/store/encounter-store.ts` (remove `statBlockCombatantId` and `showStatBlock`)
- Modify: `components/tracker/StatBlockPanel.tsx`
- Modify: `components/tracker/CombatantCard.tsx` (remove the Stat Block / Sheet button)
- Modify: `app/encounters/[id]/page.tsx` (pane always rendered)

**Interfaces:**
- Consumes: `selectedCombatantId` from the store; `portraitUrl` is not needed here.
- Produces: `StatBlockPanel` driven by `selectedCombatantId`; the store no longer exports `showStatBlock`.

- [ ] **Step 1: Collapse the two selections**

Delete `statBlockCombatantId`, `showStatBlock` and their interface entries from the store. `StatBlockPanel` reads `selectedCombatantId`. Remove the pane's close button and its Esc handler; add an Esc handler that clears the selection instead (keep the existing guard that ignores Esc while an INPUT or TEXTAREA has focus). Remove the Stat Block / Sheet button and its `(c.statBlock || c.ddbCharacter)` wrapper from `CombatantCard`'s expanded panel.

- [ ] **Step 2: Hold the width and add the empty state**

The panel keeps `w-80 min-w-80` whenever an encounter is loaded — drop the `w-0 min-w-0` collapse and the width transition. Content in priority order: PC with `ddbCharacter` → `PCSheet` with its existing sync header; any `statBlock` → `StatBlock`; neither → the combatant's name plus **Link a stat sheet** and **Create a sheet** buttons (wired in Task 10, disabled with a title until then); nothing selected → a centred muted "Select a combatant" hint.

- [ ] **Step 3: Verify in the browser**

Click a monster row — the pane shows its stat block with no second click. Click a PC — the sheet, sync header intact. Click an NPC with no sheet — name plus the two actions. Click the selected row again — row collapses, pane shows the hint, width unchanged. Press Esc — selection clears. Type in a notes field and press Esc — the selection survives.

- [ ] **Step 4: Commit**

```bash
git add lib/store/encounter-store.ts components/tracker app/encounters
git commit -m "feat: stat block pane follows row selection and never toggles"
```

---

### Task 8: The stat sheet editor

**Files:**
- Create: `components/bestiary/StatSheetEditor.tsx`
- Create: `components/bestiary/StatSheetEditorDialog.tsx`

**Interfaces:**
- Consumes: `CharacterUploadSchema`, `validateCharacterUpload` from `lib/character-schema.ts`; `portraitUrl` from `lib/library/portrait.ts`; `Tabs` from `components/ui/tabs.tsx`.
- Produces:
  - `StatSheetEditor({ value, entryId, onChange, onSave, onCancel, saving })` — `value: CharacterUploadSchema`, `entryId: string | null` (null disables the Portrait tab's upload, which needs a row to attach to).
  - `StatSheetEditorDialog({ open, onClose, ...same props })` — the same editor in a `Dialog`.

- [ ] **Step 1: Build the four tabs**

Per spec §3. **Identity** — name, type, tags, player name, colour, notes. **Stats** — AC, max HP, hit dice, speed, the six abilities in a 6-column grid, saving throws, skills, senses, languages, damage resistances / immunities / vulnerabilities, condition immunities, CR, XP. **Actions** — add / remove / reorder name+description rows for abilities, actions, bonus actions, reactions, legendary actions, plus a free-text **spellcasting** field. **Portrait** — upload, replace, remove against `/api/library/[id]/image`, plus the remote URL field.

Two notes carried from earlier tasks. The spellcasting field exists because `statBlock.spellcasting` must survive a save back to the library — without it, every spellcasting NPC loses its spell text the first time a mid-fight edit is saved. And **clearing the Stats and Actions tabs must not leave the sheet with no `statBlock` at all** when the combatant or entry had one: `applySheetEdits` writes a null stat block for a sheet that has none, which is right for a bare NPC and destructive for a creature that had a full block. Seed the editor's `statBlock` whenever the source has one and keep it present.

Every Stats and Actions field writes into `value.statBlock`, which may be absent — create it on first write rather than assuming it exists (Review Focus 2). Reuse `components/ui/tabs.tsx`; if its API does not fit a form shell, a local tab strip in this component is fine rather than reshaping the shared one.

- [ ] **Step 2: Validate on save**

Run `validateCharacterUpload` on save. Errors block and list themselves above the tab strip; warnings show but let the save through. Numeric inputs hold strings while editing and coerce on commit, so a half-typed `1` in an AC field does not round-trip as `NaN`.

- [ ] **Step 3: Commit**

Nothing hosts this component yet — Task 9 is where it gets exercised.

```bash
git add components/bestiary
git commit -m "feat: tabbed stat sheet editor"
```

---

### Task 9: The Bestiary page

**Files:**
- Create: `app/bestiary/page.tsx`
- Create: `components/bestiary/BestiaryBrowser.tsx`
- Modify: `components/shell/TopBar.tsx` (nav entry)

**Interfaces:**
- Consumes: `StatSheetEditor` (Task 8); `portraitUrl` (Task 4); `/api/library` and `/api/library/[id]`.
- Produces: the `/bestiary` route.

- [ ] **Step 1: Build the list and wire the editor**

`BestiaryBrowser` renders the library list on the left — search box (debounced into `/api/library?q=`, as `AddCombatantDialog` already does), a type filter for pc/npc/monster, and rows showing the `portraitUrl` thumbnail with a type-icon fallback — and `StatSheetEditor` on the right for the selected entry.

**Pass `key={entryId}` on the editor.** It seeds its draft rows and `imagePath` from props once, so without a key, selecting a second entry would show the first one's data. New entry POSTs to `/api/library`; save PATCHes `/api/library/[id]`; delete confirms through `useConfirm` from `components/ui/confirm-dialog.tsx` as the other entity pages do.

The library is global, so do not reach for `EntityListView` or `activeCampaignId` — this list has no campaign scope, relations or archive state. A plain list in this component is the right size.

- [ ] **Step 2: Add the nav entry**

`{ href: "/bestiary", label: "Bestiary", icon: BookMarked }` in `TopBar.tsx`, between Encounters and Characters.

- [ ] **Step 3: Verify in the browser**

Create a homebrew NPC from scratch: name, AC, HP, abilities, one action, upload a portrait. Save, reload, confirm it persisted with its image. Edit an existing entry's AC and save. Search by name and by tag. Delete an entry and confirm its portrait file is gone from `$DATA_DIR/library/`.

- [ ] **Step 4: Commit**

```bash
git add app/bestiary components/bestiary components/shell/TopBar.tsx
git commit -m "feat: Bestiary page for viewing and editing stat sheets"
```

---

### Task 10: The editor inside the tracker

**Files:**
- Modify: `components/tracker/StatBlockPanel.tsx` (Edit, Save to library, and the empty state's two actions)
- Modify: `components/tracker/AddCombatantDialog.tsx` (edit affordance on the Library tab)
- Modify: `lib/store/encounter-store.ts` (`applyCombatantSheet`)

**Interfaces:**
- Consumes: `StatSheetEditorDialog` (Task 8); `statBlockToUpload`, `applySheetEdits` (Task 3); `characterUploadToCombatant` overrides (Task 3).
- Produces: `useEncounterStore().applyCombatantSheet(combatantId: string, sheet: CharacterUploadSchema)` — applies `applySheetEdits` and marks dirty.

- [ ] **Step 1: Wire mid-fight editing**

The pane's **Edit** button opens `StatSheetEditorDialog` seeded with `statBlockToUpload(combatant)`, with `key={entryId}` on the dialog — it seeds its draft rows and `imagePath` from props once, so without a key a second combatant would open showing the first one's data. Saving calls `applyCombatantSheet` — that combatant only. When `combatant.libraryId` is set, a **Save to library** action additionally PATCHes `/api/library/[id]`; it is absent when `libraryId` is null. A PATCH returning 404 means the entry was deleted since the add: surface that in a toast and clear `libraryId` on the combatant, rather than leaving a button that always fails (Review Focus 1).

- [ ] **Step 2: Wire the empty state's actions**

**Create a sheet** opens the editor seeded from the combatant's name, AC and HP; saving POSTs a new `/api/library` row, snapshots it onto the combatant, sets `libraryId`, and — when `characterId` is set — PATCHes that character's `statSheetId`. **Link a stat sheet** opens a library search, then snapshots the chosen sheet onto the combatant, sets `libraryId`, and sets the NPC's `statSheetId` the same way.

- [ ] **Step 3: Add the Library tab's edit affordance**

A pencil button on each `AddCombatantDialog` library row opens `StatSheetEditorDialog` for that entry, PATCHing `/api/library/[id]` on save and refreshing the list.

- [ ] **Step 4: Verify in the browser**

Mid-fight: edit an ogre's AC in the pane, confirm the row's AC updates and the library entry does not. Hit Save to library, reopen the Bestiary, confirm it took. Edit max HP below current HP and confirm the clamp. On a bare NPC, use Create a sheet, then check the Bestiary has it and the NPC entity links to it. Delete that library entry, return to the encounter, and confirm Save to library reports the loss instead of silently failing.

- [ ] **Step 5: Commit**

```bash
git add components/tracker lib/store/encounter-store.ts
git commit -m "feat: edit stat sheets from the tracker, with explicit save-back"
```

---

### Task 11: NPC entity to sheet link

**Files:**
- Modify: `components/entities/CharacterFormDialog.tsx` (stat sheet picker)
- Modify: `app/api/characters/route.ts` and `app/api/characters/[id]/route.ts` (accept `statSheetId`)
- Modify: `components/tracker/AddCombatantDialog.tsx` (Characters tab)

**Interfaces:**
- Consumes: `characterUploadToCombatant` overrides (Task 3); `characters.statSheetId` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Add the picker**

A **Stat sheet** field on the NPC form: search the library and link, create a new sheet from this NPC's name, or clear the link. It writes `statSheetId` through the character POST and PATCH, which must accept and persist the field.

- [ ] **Step 2: Build the combatant from the sheet**

In the Characters tab, when the picked character has a `statSheetId`, fetch `/api/library/[id]` and build the combatant with `characterUploadToCombatant(entry.data, encounterId, { name: character.name, characterId: character.id, libraryId: entry.id })` — the entity wins the name and keeps its id, the sheet supplies the stats. Keep the manual AC/HP/initiative form for a character with no sheet, and say on the form which case the DM is in.

- [ ] **Step 3: Verify in the browser**

Link an NPC entity to a library sheet on the Characters page. Add that NPC to an encounter from the Characters tab — no AC/HP typing, the pane shows the sheet, the row shows the entity's name not the sheet's. Add a second, different NPC built from the same sheet and confirm they are not treated as duplicates of each other. Add an NPC with no sheet and confirm the manual form still works.

- [ ] **Step 4: Commit**

```bash
git add components/entities app/api/characters components/tracker
git commit -m "feat: link an NPC entity to a stat sheet"
```

---

### Task 12: Run mode's tabbed right column

**Files:**
- Modify: `app/run/page.tsx`

**Interfaces:**
- Consumes: `StatBlockPanel`'s content (Task 7); `selectedCombatantId`.
- Produces: nothing downstream.

- [ ] **Step 1: Tab the right column**

The `flex-[2]` column that currently holds `AnswerPanel` gains a two-tab strip, **Assistant** and **Stat block**, defaulting to Assistant. The Stat block tab renders the same content `StatBlockPanel` shows for `selectedCombatantId`, with its own hint when nothing is selected. Selecting a combatant must not switch tabs on its own — the DM switches deliberately. Extract the pane's content into a component both `StatBlockPanel` and this column render, rather than duplicating the priority chain.

- [ ] **Step 2: Verify in the browser**

Start a run with an encounter. Confirm the rows are the new larger ones with their token colours, the Assistant tab still works, the Stat block tab shows the selected combatant's sheet, selecting a row while on Assistant does not yank the column away, and the mid-fight editor opens from there.

- [ ] **Step 3: Run the full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

```bash
git add app/run/page.tsx components/tracker
git commit -m "feat: reach stat blocks from run mode"
```
