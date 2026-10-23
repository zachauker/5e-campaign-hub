# Vault sync

If your campaign lives in an Obsidian vault, this reads it into the hub — and keeps
reading, so the two don't drift.

Obsidian stays the place you *write*. The hub is where that writing gets connected
to maps, threads, clocks, encounters, and the table.

The connection is one-way and read-only. The hub never writes to your vault: no
frontmatter, no note bodies, no new files.

---

## Setup

There is one setting, not five.

### 1. Mount the vault

The server reads the vault from a folder on its own disk, set by the `VAULT_PATH`
environment variable (default `/vault`, which is where a container expects the
mount). Point it at the **vault root**, not at a campaign folder inside it.

On a server, mount the vault into the container **read-only**. That is on purpose:
it makes "the hub never writes to your vault" a fact about the mount, not a promise
about the code. See the [README](../../README.md#configuration) for the variable and
[DEPLOYMENT.md](../../DEPLOYMENT.md#the-obsidian-vault) for the compose mount.

### 2. Tell the hub which folder is the campaign

**Settings → Obsidian Vault → Campaign folder.** Enter the path *relative to the
vault root* — for example `D&D/Explorers of Exandria` — and press **Save**.

- It must be relative. An absolute path, or one containing `..`, is refused.
- Each campaign has its own folder, so switching campaigns in the top bar switches
  which folder you're configuring.
- Clearing the field and saving disconnects the campaign from the vault. Nothing is
  deleted.

### 3. Name the vault (for "Open in Obsidian")

**Vault name** is the name Obsidian itself knows the vault by. It's used only to
build the **Open in Obsidian** links on detail pages, so you can jump from reading a
note here to editing it there. Sync works without it.

### 4. Sync

Press **Sync now**. You get a per-section report: new, updated, unchanged,
archived, and skipped, plus any warnings.

---

## What it reads

The sync walks the campaign folder and reads every Markdown file. It decides what
each note is from the `type:` in its frontmatter.

| `type:` | Becomes |
| --- | --- |
| `npc`, `pc` | A [character](entities.md) (PC or NPC) |
| `location` | A [location](entities.md) |
| `item` | An [item](entities.md) |
| `faction` | A [faction](entities.md) |
| `session`, `arc`, `encounter`, `scene` | A [session note](sessions.md) |

Nine types, five sections. A session note's label comes from its type: `session` →
Session Notes, `arc` → Story Outline, `scene` → Character Event, and `encounter` →
Combat, RP, or Exploration Encounter depending on its `encounter_type`
(`combat`, `social`, `exploration`).

Other notes are read but not mirrored. `thread`, `player-note`, `reference`, and
`campaign` notes are skipped without comment — they're meant for the vault, not the
hub. The report counts every note it read but didn't mirror ("23 other notes in the
folder were read but not mirrored anywhere"), including any it warned about, so you
can see the number without a line for each.

Never read at all: anything in a folder named `_Templates`, anything inside a
dot-directory (`.obsidian`, `.trash`, backups), and dot-files such as the `._Foo.md`
sidecars a Mac leaves on a network share.

### Properties

Frontmatter fields the sync understands become **properties** on the entry —
visible on its detail page and usable as a [filter, sort, or table
column](entities.md). Fields it doesn't recognise are left alone.

| Section | Frontmatter used |
| --- | --- |
| **Characters** | `type` (pc/npc), `race`, `class`, `level`, `disposition`, `role`, `sheet`, `factions`, `location`, `active` |
| **Locations** | `location_type`, `status`, `region`, `parent`, `description` |
| **Items** | `item_type`, `rarity`, `description`, `held_by` |
| **Factions** | `faction_type`, `stance`, `headquarters`, `active` |
| **Session notes** | `session`, `date`, `status`, `arc`, `encounter_type`, `featuring`, `locations`, `settings` |

Some of these do more than display:

- A character's **`sheet`** URL, if it's a D&D Beyond link (`dndbeyond.com` or the
  short `ddb.ac` form), connects them to their live sheet in [the tracker](encounters.md).
- **`factions`**, **`location`**, **`held_by`**, **`parent`**, and **`locations`**
  take `[[wikilinks]]` and draw the links between entries — the ones that show up on
  detail pages and feed the assistant. The sync only ever *adds* links; it never
  removes one you've drawn in the hub.
- A session note's **`locations`** puts it on the map. The older **`settings`** field
  (plain location names) is used only when a note has no `locations` links.
- A location's **`parent`** nests it under another location.

The note's Markdown body is not a property: it's rendered in place on the entry's
**Vault Note** tab, and it's what [briefings](run-mode.md) read. It also feeds the
[search index](settings.md#search-index), so run-mode search finds prose that exists
only in the note. A `description:` in the frontmatter is indexed too, alongside the body.
Anything inside a `> [!dm]` callout is kept out of the search index.

---

## How it decides what to do with a note

Four outcomes per note, and the middle one is the useful one.

**New** — no matching entry existed.

**Updated** / **Unchanged** — the entry was already linked to this note; its vault
fields were refreshed, or nothing had changed. (The report folds *adopted* into
*Updated*.)

**Adopted** — an entry already existed but wasn't linked to a note, so the sync
claims it instead of making a duplicate. It happens in two ways: the entry carries
the same name as the note (so you can type entries by hand and connect the vault
later), or the note's identity matches one from before — see below.

**Archived** — the note is gone from the vault, or its `active:` is `false`
(characters and factions), or its `type:` changed to a different section. Archived
entries are hidden but not deleted, so pins, links, and threads pointing at them
keep working. **Show archived** in any section brings them back into view, and a
note that returns un-archives its entry.

### How a note is recognised

Each note identifies as one of these, in order:

1. **`hub_id`** in its frontmatter — a stable id you give the note.
2. **`notion_id`** in its frontmatter — left over from when the vault was imported
   from Notion. The hub's existing entries carry the same ids, so the first sync
   adopts them instead of duplicating them. Leave these in place.
3. **The file name**, as a last resort.

A note with neither id is recognised by its file name, so **renaming it reads as
"the old note vanished, a new one appeared"**: the old entry is archived and a new
one is created, orphaning the pins and threads on the old one. If you're going to
rename a note, give it a `hub_id` first (the hub won't add one for you — it never
writes to the vault). A note that *gains* an id later is matched to its old entry
rather than duplicated.

Two notes claiming the same id are a conflict: the one with the lowest path wins,
and the report warns.

---

## Who owns which field

The rule that prevents surprises: **the vault owns what it provides; the hub owns
the rest.**

The vault owns names, properties, the note body, and whether an entry is archived —
plus the description on items and locations, when the note supplies one. The hub
owns everything the vault has no opinion about: map pins, threads and clocks,
briefings, links you've drawn, the location types that drive map layering. A D&D
Beyond connection is shared: a `sheet:` that is a D&D Beyond link sets it, and
anything else leaves it alone.

Three deliberate exceptions, all there to stop the sync from destroying work:

- A **blank** `description:` in the vault doesn't overwrite an existing description.
  Emptying a field is not the same as saying "delete what's there."
- A **`sheet:`** that isn't a recognisable D&D Beyond link (or no `sheet:` at all)
  doesn't clear a D&D Beyond connection you've set in the hub. The URL still shows
  as a **Sheet** property. To disconnect a character, do it in the hub.
- A location's **type** is never written by the vault, because it decides how the
  location is drawn and grouped on the map. A `location_type` in the note shows as
  a property, nothing more.

Practical upshot: hand-editing a synced field is fine as a quick fix, but the next
sync reverts it. Change it in Obsidian.

---

## Automatic sync

**Settings → Obsidian Vault → Automatic background sync** turns on a scheduler that
syncs every 5, 15, 30, or 60 minutes.

It's on by default, at 15 minutes, once a campaign has a folder. The first pass runs
shortly after the server starts. It covers every campaign with a folder, and it's
safe: only one sync per campaign can run at a time, so an automatic pass and a
manual **Sync now** can't collide. The panel shows when the last sync ran.

Turn it off if you'd rather sync deliberately — a sync mid-session will happily
rename an NPC under you.

---

## Reading the report

Each section gets a row of counts:

| Column | Meaning |
| --- | --- |
| **New** | Entries created this pass |
| **Updated** | Entries refreshed from their note (including adopted ones) |
| **Unchanged** | Entries whose note hadn't changed |
| **Archived** | Entries hidden because their note went away |
| **Skipped** | Notes of that type that couldn't be turned into an entry |

Warnings appear underneath. None of them stop the sync; each says something wasn't
done:

- **Skipped *path*: no type: in its frontmatter** / **unknown type "…"** — the note
  can't be routed to a section. Usually a typo (`locatoin`). Its existing entry, if
  any, is left visible while you fix it.
- **Skipped *path*: …** with a reason, or **the note has no name** — the note
  couldn't be read or parsed (often broken frontmatter), or produced an unnamed
  entry. Fix the note and the next sync picks it up.
- **Two or more notes share the source key "…"** — two notes carry the same
  `hub_id` or `notion_id`, usually from duplicating a note. Only the lowest path
  syncs. Give the copy its own id or remove the id.
- **No vault note matches the link "…"** — a `[[wikilink]]` in a link field points
  at a note that doesn't exist, so that link wasn't drawn.
- **No hub location matches setting "…"** — a session note's `settings` name
  matched no location.
- **Archived N entries no longer in the vault: "…"** — the sync archived these
  entries because their notes are gone (up to ten are named, then "and N more").
  If one of them should still exist, the note was renamed or lost its id.
- **"…" had no hub_id or notion_id, so it was created from the file name in the same
  pass that archived "…"** — almost always a note whose identity didn't carry over:
  the old entry (with its pins, links and briefing) is archived and a blank one
  replaced it. Put the archived entry's key on the note (its `notion_id`, or for an
  entry made from a file name, a `hub_id` set to that old name) and the next sync
  re-adopts it. See "A name changed and now there are two entries" below and the
  first-sync pre-flight in `DEPLOYMENT.md`.
- **Skipped *path*: … symlink** — the vault holds a symlink the sync doesn't follow.
  It counts as a part of the folder that couldn't be read, so nothing is archived
  until the link is replaced with the real folder or note.
- **Part of the campaign folder could not be read, so nothing was archived this
  pass** — see below.
- **No usable notes for …; skipped archiving to avoid a mass wipe** and **The
  campaign folder holds no readable markdown notes** — see below.

### The safety nets

A sync that can't see your whole vault will not conclude that your notes were
deleted. If a directory can't be read, a note won't parse, or a section's notes
vanish entirely, the sync **doesn't archive anything** that pass and says so in a
warning. Updates and new entries still go through; deletions wait until the folder
reads cleanly. This is deliberate: archiving on a bad read would hide live entries
and strand the pins and threads attached to them.

---

## When it doesn't work

**"The vault folder isn't reachable from the server."** This is the mount, not your
notes. The server couldn't read the campaign folder — the vault isn't mounted into
the container, `VAULT_PATH` is wrong, the share dropped, or the folder path doesn't
exist under the vault root. Check the mount first. Nothing was changed, and the same
message is kept as the "last sync failed" status so a background pass that failed
while you weren't looking is still visible.

**"No folder set."** The campaign has no folder saved yet. **Sync now** stays
disabled until you've saved one.

**A sync is already running.** An automatic pass or another click got there first;
try again in a moment.

**An entry is missing.** Check the note's `type:` (see the table above), that it's
not under `_Templates` or a dot-directory, and the report's warnings for its path.

**An entry has a stale name or property.** The sync runs on a schedule, not on every
save — press **Sync now**, or wait for the next automatic pass.

**A name changed and now there are two entries.** A note recognised only by its file
name was renamed, so the sync archived the old entry and created a blank one. **Don't
delete the archived entry**: its map pins, thread links and briefing are still on it.
Instead, give the renamed note a `hub_id:` set to the old file name, exactly as it was
spelled and without the `.md` (the archived entry's name in the sync warning "Archived
N entries no longer in the vault"). The next sync re-adopts the archived entry and
un-archives it, with everything still attached, and archives the blank one. The note
is now keyed on its `hub_id`, so a later rename can't do this again. (An entry that
came across from Notion keeps its `notion_page_id` instead: put that on the note as
`notion_id:`. The first-sync pre-flight in `DEPLOYMENT.md` does this for the two
id-less notes in the live vault.)

---

## Not synced

The vault is read-only from here. The hub never writes back — no properties, no note
content, no new files — and the mount is read-only so it couldn't if it tried.

The things that *read* your note text rather than its properties are
[briefings](run-mode.md#briefing-cards) and [session
review](chronicle.md#session-review), which uses the text of a session note to
propose thread and clock updates. Neither changes the note.
