# Encounter tracker tweaks — design

**Date:** 2026-11-24
**Status:** awaiting approval
**Sub-project:** encounter tracker (#17 follow-on)

## Intent

Four changes to the encounter tracker, all aimed at the same thing: the tracker
is hard to read mid-combat. The last two fights Zach ran, finding a specific
number on a row took longer than it should, and four goblins on screen looked
identical. The tracker leans hard on being compact; elements are individually
small and spread corner to corner, so nothing is findable at a glance.

The fourth change is bigger than a tweak: the creature/NPC library exists as
data but has no view, so homebrew can only be edited by hand-writing JSON.

## Goals

1. The stat block / character sheet pane opens on its own when a row is
   selected. No separate button, no toggling.
2. A combatant row is readable at a glance, from DM distance, mid-fight.
3. Stat sheets can be viewed and edited in the app — at prep time mostly, but
   also mid-fight — without touching JSON.
4. Multiple copies of one creature are distinguishable without reading.
5. An NPC entity can carry a stat sheet, so linking that NPC into a fight shows
   its sheet instead of making the DM hand-type AC and HP.

## Non-goals

- No new combat mechanics. No auto-rolling damage, no damage types, no
  automatic condition effects.
- No change to the D&D Beyond sync or to `PCSheet`.
- No change to how the Obsidian vault sync owns lore fields on `characters`.
- The library stays global, not campaign-scoped. A recurring villain is one
  sheet across campaigns.
- No image editing — no cropping, no resizing beyond what upload needs.
- Monster search (Open5e) is untouched.

## Anti-goals

These would make the work a failure even if every feature technically works:

- **Big fights become a scrolling exercise.** Rows get bigger, but a
  13-combatant fight must still be mostly visible. This ruled out the tallest
  row option during design.
- **A mid-fight edit silently rewrites a homebrew template.** Fixing an ogre's
  HP during a fight must not change the saved sheet.
- **Two editors for one kind of data** that drift apart.
- **The pane eating width the initiative list needs.** It stays at `w-80`.

## Constraints

- **The vault sync owns lore on `characters`.** Vault sync writes that table
  with a column-scoped `set()` built from `baseValues()`
  ([lib/vault/repos.ts:93](../../../lib/vault/repos.ts)), so a new column on
  `characters` is *not* clobbered on the next sync. This is what makes the
  chosen approach safe.
- **Migrations are hand-written and idempotent** — `addColumnIfMissing(...)`
  calls at the bottom of [lib/db/migrate.ts](../../../lib/db/migrate.ts).
  Drizzle-kit is configured but the running pattern is the manual one; follow it.
- **Combatants already snapshot their stat block.** `combatants.stat_block` is a
  JSON copy, not a reference. The design leans on this for edit isolation.
- **Image storage pattern already exists.** [lib/maps/storage.ts](../../../lib/maps/storage.ts)
  writes beside the SQLite DB (`$DATA_DIR`, the `./data:/data` mount) and serves
  through an API route. No new volume or env var needed.
- **`combatants.color` already exists** in schema and migration and is read
  nowhere — but it is not always written as `null`.
  `characterUploadToCombatant` passes a sheet-authored `data.color` straight
  through, and `EXAMPLE_CHARACTER_JSON` ships one, so Library-tab and
  Upload-tab adds already set it. §4 defines the precedence between that colour
  and the token colour.
- **Nothing records which library entry a combatant came from.**
  `characterUploadToCombatant` takes only the sheet `data`, so `addFromLibrary`
  drops the entry id. §3's "save back to library" needs that provenance, hence
  the fifth column below.
- Self-hosted, single DM, no auth. Deployment is the Unraid Docker image.

## Approaches

Three decisions were live. Each was chosen by Zach during design.

### Where stat sheets live

- **A — Sheets live in `character_library`; NPC entities point at one.**
  *Chosen.* One home, one editor. Lore stays vault-owned in `characters`,
  combat stats stay app-owned in `character_library`, joined by a nullable
  `stat_sheet_id`. Cost: an NPC is two records joined by a link made once.
- **B — Stat sheet columns on `characters` directly.** Rejected: two editors for
  the same data; monsters have no entity row so they can't share it; NPC
  entities are campaign-scoped, so a recurring villain gets re-entered per
  campaign.
- **C — Merge the library into `characters` as a `monster` type.** Rejected:
  hands vault sync ownership of rows that aren't vault notes, campaign-scopes
  global homebrew, and needs a data migration.

### Row layout

- **A — Scale the current arrangement up.** Rejected: still five scan targets
  spread corner to corner, just bigger.
- **B — Identity left, vitals boxed together right.** *Chosen.* Initiative,
  portrait and name pull into one unit; AC and HP sit inside a single bordered
  box. Two scan targets instead of five, at ~86px per row.
- **C — Two lines, with a full-width stats strip below the name.** Rejected:
  most readable per row, but ~112px means ~6 rows visible instead of ~11.

### Stat sheet editor

- **A — One long scrolling form.** Rejected: a full stat block is long; mid-fight
  you'd scroll past abilities to reach actions.
- **B — Tabbed sections** (Identity / Stats / Actions / Portrait). *Chosen.*
  Each tab fits without scrolling; mid-fight you jump straight to the tab you
  need.
- **C — Form left, live stat block preview right.** Rejected: most work of the
  three, and cramped at the pane's width.

### Duplicate distinction

- **A — Token colors**: numbered badge on the portrait plus a colored left edge.
- **B — A bolder ordinal chip, no color.** Rejected as still asking the DM to
  read a digit.
- **C — Token colors plus a short editable label.** *Chosen.* Zach wants to
  designate board position or another situational identifier — "on the roof",
  "the one with the bow".

## The design

### Data model

Five changes, all additive, all via `addColumnIfMissing` in
[lib/db/migrate.ts](../../../lib/db/migrate.ts) plus the matching Drizzle
column in [lib/db/schema.ts](../../../lib/db/schema.ts):

| Table | Column | Type | Purpose |
|---|---|---|---|
| `characters` | `stat_sheet_id` | `TEXT REFERENCES character_library(id)` | NPC entity → stat sheet link. Nullable. Vault sync does not touch it. |
| `combatants` | `label` | `TEXT` | Situational identifier ("on the roof"). Per-combatant, never written back to the library. |
| `combatants` | `library_id` | `TEXT REFERENCES character_library(id)` | Which library sheet this combatant was built from, so edits can be saved back. Nullable; set by the Library tab, by the Upload tab when the upload is also saved to the library, and by the NPC-entity path. |
| `combatants` | `color` | *(already exists)* | Token color for duplicates. Currently always `null`; starts being written and read. |
| `character_library` | `image_path` | `TEXT` | Uploaded portrait filename, same shape as `maps.image_path`. |

Portrait resolution order for a library entry: uploaded `image_path` wins, then
`data.statBlock.imageUrl` (a remote URL), then the type icon.

`label`, `library_id` and `color` all have to reach the database: add them to
`combatantPatch` in [lib/encounters/save.ts](../../../lib/encounters/save.ts)
and to the combatant payload in
[lib/encounters/payload.ts](../../../lib/encounters/payload.ts). `label` and
`color` belong in the *combat snapshot* too — they change mid-fight, and the
`pagehide` flush sends only the snapshot.

`CharacterUploadSchema` also gains an optional `notes?: string` for the
Identity tab's notes field, which the schema has no home for today. It is sheet
prep text (tactics, voice, how the creature fights), distinct from
`combatants.notes`, which stays per-fight.

### 1. The pane is always there

- **Collapse the two selections into one.** `statBlockCombatantId` and
  `showStatBlock` come out of
  [lib/store/encounter-store.ts](../../../lib/store/encounter-store.ts);
  `StatBlockPanel` reads `selectedCombatantId`.
- **Remove the Stat Block / Sheet button** from the expanded row in
  [CombatantCard.tsx](../../../components/tracker/CombatantCard.tsx).
- **The panel holds `w-80` whenever an encounter is loaded** — no width
  animation, no collapse-to-zero. Only its content changes.
- **Clicking the active row again still collapses it**, which leaves the pane in
  its empty state. `Esc` now clears the selection rather than closing the pane
  (the old close button and its Esc hint both go away).
- Content, in priority order:
  1. PC with `ddbCharacter` → `PCSheet` (unchanged, including the sync header).
  2. Any combatant with a `statBlock` snapshot → `StatBlock`.
  3. Neither → the combatant's name and two actions: **Link a stat sheet**
     (search the library) and **Create a sheet** (opens the editor prefilled
     from the combatant's name, AC and HP).
- A combatant linked to an NPC entity gets its sheet **as a snapshot at add
  time** (see §3), so the pane needs no live fetch in the common case. Case 3's
  "Link a stat sheet" covers the DM who links the sheet to the NPC *after* the
  combatant is already in the fight, and pulls the sheet into this combatant.

**Both case-3 actions write beyond the combatant**, or goal 5 is not met:

- **Create a sheet** POSTs a real `character_library` row, snapshots it onto the
  combatant and sets `combatants.library_id`. When the combatant has a
  `character_id`, it also sets that NPC's `stat_sheet_id`, so next session's add
  finds the sheet by itself.
- **Link a stat sheet** does the same minus the POST: snapshot, set
  `library_id`, and set the NPC's `stat_sheet_id` when there is a
  `character_id`.

**Run mode.** The run page ([app/run/page.tsx](../../../app/run/page.tsx))
renders `InitiativeTracker` beside the assistant's `AnswerPanel` with no pane at
all, so removing the row's button would leave a live session unable to read a
stat block. Instead, **the run page's right column gains a tab switch between
Assistant and Stat block**, driven by the same `selectedCombatantId`. No extra
width, so the initiative list keeps its space. Selecting a combatant does not
steal the column from the assistant — the DM switches tabs deliberately, and the
Stat block tab shows a hint when nothing is selected. The mid-fight editor is
reachable from there just as it is from the encounter page.

### 2. Row layout

Rebuild the header row of `CombatantCard` as two groups. Target ~86px tall.

```
┌────────────────────────────────────────────────────────────────┐
│ ████████████████████░░░░░░░░░░  ← 6px HP strip, health-colored │
│                                                                │
│  ⋮⋮  ┌────┐  ( 48 )  Goblin 1        ┌──────────────────────┐  │
│      │ 18 │  portrait  🗡 monster     │  AC    │   HP    │ + │  │
│      │init│                          │  15    │  7/7    │ − │  │
│      └────┘                          └──────────────────────┘  │
│      └──── identity group ────┘       └── vitals box ──┘       │
└────────────────────────────────────────────────────────────────┘
```

- **Identity group** (left, flexes): drag handle; initiative box 54×52 with the
  value at 22px/750 tabular-nums over a 9px uppercase `init` label; portrait
  48×48; name 17px/650 with the type-and-player subtitle at 12px.
- **Vitals box** (right, fixed): one bordered container, `oklch(0.185 0.014 46)`
  on `--border`, holding AC and HP at 20px/750 tabular-nums under 9px uppercase
  labels, separated by a 1px divider, with stacked +/− buttons (28×21) at the
  end. **The HP number carries the health color** (`hpColor`), with the `/max`
  denominator in muted text.
- The 6px HP strip stays at the top of the card. The conditions row stays below
  the header, aligned under the name.
- The active combatant keeps its gold border, glow and name tint; the dead state
  keeps its grayscale-and-strikethrough.
**The vitals box's HP interaction** must not regress the most-used action of a
fight. Today's `compact` mode has no +/− at all: it is a bar with `7/7` on it,
and all damage is typed into the expanded panel's damage/heal/set control. So
the vitals box gets both:

- **The +/− buttons are ±1 nudges**, for the small corrections that are most of
  a fight's HP traffic.
- **Clicking the HP number opens the typed control inline** — the same
  damage / heal / set modes as the expanded panel, so a 14-damage hit is still
  one number and Enter, without opening the row.
- **The floating damage number comes along.** `hp-float` currently renders only
  in `compact` mode, which the new row stops using; it must fire from the vitals
  box instead, or every hit loses its feedback.

`HPControls` grows this third presentation. Its `compact` mode stays for any
other caller, and its full mode in the expanded panel stays as the place for
temp HP.

### 3. The Bestiary

**A top-level page at `/bestiary`**, in the nav between Encounters and
Characters. Also reachable from the Add Combatant dialog's Library tab, which
gains an edit affordance opening the same editor in a dialog. One editor
component, two entry points.

Layout: library list on the left (search, type filter, portrait thumbnails),
editor on the right with four tabs.

- **Identity** — name, type, tags, player name, color, notes.
- **Stats** — AC, max HP, hit dice, speed, the six abilities, saving throws,
  skills, senses, languages, damage resistances / immunities /
  vulnerabilities, condition immunities, CR, XP.
- **Actions** — repeatable name/description lists for abilities, actions, bonus
  actions, reactions and legendary actions, with add, remove and reorder.
- **Portrait** — upload, replace, remove; remote URL as a fallback field.

The editor reads and writes the existing `CharacterUploadSchema`
([lib/character-schema.ts](../../../lib/character-schema.ts)) and validates
through `validateCharacterUpload`, so a hand-edited sheet and an uploaded JSON
sheet are the same thing. Warnings surface in the editor rather than blocking a
save; errors block.

**API.** `/api/library` and `/api/library/[id]` already do GET / POST / PATCH /
DELETE and need no change. Add portrait endpoints mirroring the maps routes:

- `POST /api/library/[id]/image` — multipart upload, writes via a new
  `lib/library/storage.ts` modelled on `lib/maps/storage.ts` (directory
  `$DATA_DIR/library/`), sets `image_path`.
- `GET /api/library/[id]/image` — serves the file with the right content type;
  404 when absent.
- `DELETE /api/library/[id]/image` — removes file and column.

Deleting a library entry must also delete its portrait file.

**NPC entity link.** The NPC form on the Characters page
([CharacterFormDialog.tsx](../../../components/entities/CharacterFormDialog.tsx))
gains a **Stat sheet** picker: search the library and link, create a new sheet
from this NPC's name, or clear the link. It writes `characters.stat_sheet_id`.

**Linking an NPC into a fight.** The Add Combatant dialog's Characters tab
currently makes the DM hand-type AC, HP and initiative for any linked
character. When the picked NPC has a stat sheet, build the combatant from that
sheet instead — AC, max HP, speed, initiative bonus, `statBlock` and portrait
all prefilled, via the existing `characterUploadToCombatant`. Keep the manual
form for an NPC with no sheet.

**On that path the entity wins the identity, the sheet supplies only stats.**
`characterUploadToCombatant` would otherwise name the combatant after the sheet
and null out the link, so "Grik the Bandit" linked to a "Bandit Captain" sheet
would show up as "Bandit Captain". The combatant keeps the entity's `name` and
its `character_id`, and takes `library_id` from the sheet. This matters twice
over: the name also feeds §4's base-name grouping, so two bandits built from one
sheet but linked to two different NPCs stay two individuals, not a numbered
pair.

**Portrait references stay live.** A combatant built from a library entry points
its `avatarUrl` at `/api/library/[id]/image` rather than copying the bytes, so
replacing a portrait updates it in old encounters too. That is the cheaper call
and the lesser evil: a deleted entry leaves a broken image, which the card's
existing `onError` handler already hides, falling back to the type icon.

**Mid-fight editing.** The pane gains an **Edit** button opening the same tabbed
editor against the combatant's own `statBlock` snapshot. Changes affect that
combatant only. When `combatants.library_id` is set, a second **Save to
library** action writes the edits back to the source sheet; it is absent
otherwise. This is the edit-isolation anti-goal made concrete: a quick HP fix
during a fight never rewrites the template by default.

**It opens as a dialog over the tracker**, not inside the pane. Editor approach
C was rejected for being cramped at `w-80`, and the same objection applies to
putting a four-tab form in a 320px column. One editor component is therefore
hosted in three places: the Bestiary's right column, a dialog from the Add
Combatant dialog's Library tab, and a dialog from the pane.

**Field authority.** A combatant stores AC, max HP and speed *twice* — as flat
columns (`combatants.ac`, `hp_max`, `speed`) and inside its `statBlock` JSON
(`ac`, `hp`). The forward converter exists; nothing maps a `StatBlock` back to
`CharacterUploadSchema`. The rules, which the builder should write a reverse
converter to honour:

- **The flat columns are the live combat truth.** The row, initiative order and
  HP maths read them; `statBlock` is reference text for the pane.
- **An edit through the editor writes both** — a mid-fight AC change updates
  `combatants.ac` *and* `statBlock.ac`, so the row and the sheet never disagree.
- **Editing max HP does not reset current HP.** It clamps: a creature on 31/59
  edited to a 40 max sits at 31/40, and one on 50/59 edited to a 40 max drops to
  40/40.
- **The +/− and typed damage never touch `statBlock.hp`.** Current HP is fight
  state; the sheet's `hp` is the creature's maximum. This is the one place the
  two are *meant* to differ.

### 4. Telling duplicates apart

**What counts as a duplicate.** Two combatants share a source when they have the
same `monster_slug`; failing that, the same `character_id`; failing that, the
same base name (the name with a trailing ordinal stripped). Badges, colors and
stripes appear **only** when a group has two or more members — a lone ogre stays
clean.

**Token color.** Each copy gets a color from a fixed ordered palette, assigned
by instance index at add time and stored in `combatants.color`. It shows twice
on the row: a numbered badge (21px, bottom-right of the portrait, 2px card-colored
ring) and a 4px stripe down the row's left edge.

`combatants.color` is therefore the row's accent color, with one precedence
rule: **a token color beats a sheet-authored color.** A sheet's `color` is
decoration; telling two goblins apart is the job. So on add, a combatant joining
a duplicate group takes the next palette color, and a lone combatant keeps
whatever `color` its sheet supplied (today's behavior, now actually rendered as
the left stripe). When a group forms, the first copy is assigned a token color
too, overwriting a sheet color it may have had. The Identity tab keeps its
`color` field as the sheet's default.

**Auto-numbering.** Today only a batch add numbers its copies, so adding goblins
one at a time leaves them all called "Goblin". From now on, adding a combatant
that matches an existing source takes the next ordinal — and when the second
copy arrives, the lone first one is renamed to `"<name> 1"` so the set reads
consistently.

**A hand-edited name is left alone, detected by comparison, not by a flag.** The
source name is known (the monster slug's name, the library entry's name, or the
NPC entity's name), so a combatant whose current name is neither that name nor
that name plus an ordinal has been renamed by the DM. Consequences, spelled out
because they are easy to get wrong:

- Rename "Goblin" to "Grik" and add another goblin: Grik keeps its name, and
  the new one becomes "Goblin 2". The ordinal counts instances in the group, not
  the numbered ones, so no two rows ever share a number. Both still get token
  colors — that is what distinguishes them.
- The retroactive rename of copy #1 touches a row the add would not otherwise
  write, so it is a store update like any other and rides out on the next
  auto-save; it needs no special persistence beat.

**Situational label.** `combatants.label`, free text, empty by default, shown as
a dashed chip in the subtitle line and edited inline on click. This is for board
position or whatever else distinguishes a copy in the moment. Per-combatant;
never written back to the library.

## Left to the builder

- **The token palette's exact values.** Needs ~8 colors that read as distinct
  from each other in the dark theme and give the badge's number enough contrast.
  It must not collide with the meanings already carried by `--hp-high/med/low`
  (health) or `--initiative` gold (whose turn it is).
- **Label chip behavior at narrow widths** — truncate or wrap.
- **Component decomposition of the editor**, and how much of the tab shell is
  shared with the existing `components/ui/tabs.tsx`.
- **Whether the Bestiary list reuses `EntityListView`** or is simpler on its
  own. The library is global and has no campaign scoping, relations or archive
  state, so the existing entity machinery may be a poor fit; builder's call.
- **Test placement and depth**, following the repo's existing vitest patterns
  (tests next to the code under `lib/`). The pure logic worth covering:
  duplicate grouping, ordinal assignment and hand-edited-name detection; color
  precedence; portrait resolution order; the max-HP clamp; and the
  `StatBlock` → `CharacterUploadSchema` reverse converter's round-trip against
  `validateCharacterUpload`.
- **Whether the reverse converter lives in `lib/character-schema.ts`** beside
  its forward twin or in its own module.
- Whether `/bestiary` or another route name reads better in the nav.
