# Notion sync

If your campaign already lives in Notion, this pulls it into the hub — and keeps
pulling, so the two don't drift.

Notion stays the place you *write*. The hub is where that writing gets connected to
maps, threads, clocks, encounters, and the table.

---

## Setup

### 1. Create an integration

Go to [notion.so/my-integrations](https://www.notion.so/my-integrations), create an
internal integration, and copy its secret.

Paste it into **Settings → Notion Integration** and save.

### 2. Share your databases with it

In Notion, open each database → **⋯** → **Connections** → add your integration.

### 3. Point the hub at each database

**Settings → Notion Sync** has a slot for each of five sources. Paste the database
URL and press **Save**:

| Slot | Becomes |
| --- | --- |
| **Characters** | [Characters](entities.md) |
| **Items & Loot** | [Items](entities.md) |
| **Factions & Organizations** | [Factions](entities.md) |
| **Locations** | [Locations](entities.md) |
| **Session Timeline** | [Sessions](sessions.md) |

You don't need all five. Configure the ones you keep.

### 4. Sync

Press **Sync now**. You get a per-source report: created, adopted, updated,
unchanged, archived, plus any warnings.

---

## What it reads

The sync looks for properties by name. Anything it finds becomes a **Notion
property** on the entry — visible on its detail page, and usable as a
[filter, sort, or table column](entities.md).

| Source | Properties used |
| --- | --- |
| **Characters** | Name, Type (*Player* → PC, anything else → NPC), Race, Class, Character Level, Disposition Toward Party, Role/Title, Character Sheet, Affiliations, Active |
| **Items** | Name, Type, Rarity, Description, Held By |
| **Factions** | Name, Type, Alignment Toward Party, Active |
| **Locations** | Name, Type, Status, Region, Description, Notable NPCs |
| **Session Timeline** | Name, Type, Status, Date, Setting(s) |

Three of these do more than display:

- A character's **Character Sheet** URL, if it's a D&D Beyond link, connects them
  to their live sheet in [the tracker](encounters.md).
- **Affiliations**, **Held By**, and **Notable NPCs** draw the links between
  entries — the ones that show up on detail pages and feed the assistant.
- A session note's **Setting(s)** matches against your location names, which is
  what puts a session on the map.

Property names must match. If a database calls it *Faction* rather than
*Affiliations*, the sync won't find it.

---

## How it decides what to do with a row

Four outcomes per row, and the middle one is the useful one:

**Created** — no matching entry existed.

**Adopted** — an entry with the same name already existed in the hub but wasn't
linked to Notion, so the sync claims it instead of making a duplicate. This is
what makes it safe to start typing entries by hand and connect Notion later.

**Updated** / **Unchanged** — the entry was already linked; its Notion-owned fields
were refreshed, or nothing had changed.

**Archived** — the row is gone from Notion, or its **Active** checkbox is off.
Archived entries are hidden but not deleted, so pins, links, and threads pointing
at them keep working. **Show archived** in any section brings them back into view.

---

## Who owns which field

The rule that prevents surprises: **Notion owns what it provides; the hub owns the
rest.**

Notion owns names, descriptions, and its own properties. The hub owns everything
Notion has no opinion about — map pins, threads and clocks, briefings, the
location types that drive map layering, D&D Beyond connections.

Two deliberate exceptions, both there to stop the sync from destroying work:

- A **blank** description in Notion doesn't overwrite an existing one. Emptying a
  field is not the same as saying "delete what's there."
- A location's **type** is never overwritten by Notion, because it decides how the
  location is drawn and grouped on the map.

Practical upshot: hand-editing a synced field is fine as a quick fix, but the next
sync reverts it. Change it in Notion.

---

## Automatic sync

**Settings → Notion Sync → Automatic background sync** turns on a scheduler that
syncs every 5, 15, 30, or 60 minutes.

It's on by default once you've configured sources, and it's safe: only one sync per
campaign can run at a time, so an automatic tick and a manual **Sync now** can't
collide. Each source shows when it last synced.

Turn it off if you'd rather sync deliberately — a sync mid-session will happily
rename an NPC under you.

---

## When rows don't sync

**Some pages sync and others don't.** Almost always the integration isn't
connected to those individual pages. Notion propagates a connection down from the
database at the time the page is created — pages that were moved in, duplicated
from elsewhere, or restored from trash can miss it. Open one and check its
**Connections**; the fix is per-page, not a bug in the sync.

**Nothing syncs at all.** Check the token is saved, the database URL is right, and
the integration is on the database itself.

**Properties are missing.** Check the exact property name against the table above.

**A name changed and now there are two entries.** Adoption matches on name, so
renaming in Notion between syncs can create a second entry. Delete the stray one.

---

## Not synced

Notion is read-only from here. The hub never writes back — no properties, no page
content, no new rows.

The one thing that *reads* your page bodies rather than your properties is
[session review](chronicle.md#session-review), which uses the text of a session
note to propose thread and clock updates. It still doesn't write to Notion.
