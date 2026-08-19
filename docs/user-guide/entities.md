# Characters, locations, items & factions

The campaign glossary. Four sections that behave identically, so learning one
teaches you the others:

| Section | Holds |
| --- | --- |
| **Characters** | PCs and NPCs |
| **Locations** | Cities, towns, points of interest, regions |
| **Items** | Loot, artifacts, the letter someone won't stop asking about |
| **Factions** | Organizations, guilds, cults, courts |

Entries can be typed in by hand or [synced from Notion](notion-sync.md). Once
they're here they feed everything else — map pins, thread links, clock owners,
Run mode lookups, the assistant's answers.

---

## The list

Each section opens on a list of everything in the active campaign, with a count in
the header and **New …** at the top right.

### Three ways to look at it

The toolbar's three icons switch views, and your choice sticks per section:

- **List** — one row each: name, type, a line of description. The most entries per
  screen.
- **Gallery** — cards. Better when you're browsing rather than hunting.
- **Table** — a spreadsheet, with columns you choose. The one to use when you want
  to compare rather than read.

In **table** view, the toolbar grows a **Columns** control listing every Notion
property found across your entries. Turn on the two or three that actually matter
for what you're doing — a table of NPCs by *Status* and *Faction* answers a
different question than one by *Location*.

### Narrowing it down

- **Search** matches names and descriptions as you type.
- **Filter** builds on whatever your data actually contains: the built-in type
  (PC/NPC for characters; city/town/POI/region for locations) plus every Notion
  property on your entries, each offering the values that are really in use. Pick
  as many values per field as you like; active filters appear as chips you can
  clear individually.
- **Sort** by name or by any of those same fields, ascending or descending.

Filters and search combine — narrow to `Faction: Myriad`, then type `captain`.

### Archived entries

An entry that disappeared from its Notion database isn't deleted; it's archived, so
history and links survive. If a section has any, a **Show archived (N)** button
appears in the header to bring them back into view.

Deleting by hand, from the row's own delete button, *is* permanent. It asks first.

---

## Quick view

Clicking an entry's **name** in any view opens a popover with the essentials —
type, description, and its links — without leaving the list. `Esc` closes it.

This is the fastest path when you're scanning for the right one of four
similarly-named nobles. When you actually want the entry, the arrow button on the
row (or card) opens its full page.

---

## Detail pages

Clicking an entry opens its page, which has two tabs.

### Overview

- **Description** and type.
- **Notion properties**, rendered as a table, when the entry came from Notion.
- **On the map** — every marker pointing at this entry, each a link straight to
  that spot on that map.
- **Linked characters** — for a location, faction, or item, everyone connected to
  it. On a character's page, their factions, locations, and items instead.
- **Events here** — for locations, the session notes that happened there.
- **Open threads** involving this entry, with their stakes.

### Notion notes

The full body of the linked Notion page, rendered in place: headings, lists,
callouts, toggles, tables. This is where your actual prose lives — you write it in
Notion, you read it here, next to everything the app knows about the same subject.

If nothing's linked, the tab says so and points you at **Edit** to paste a URL.

---

## Creating and editing

**New …** opens a form with a name, description, type, and an optional Notion page
URL. The row's edit button opens the same form for an existing entry.

Characters get a little more: their PC/NPC type, and links to factions, locations,
and items.

**One caution if you sync with Notion.** Fields that Notion owns get overwritten on
the next sync. Hand-editing a synced entry's name or description is fine for a
one-off correction, but the durable place to change it is Notion. Fields the hub
owns — links you've drawn, the entry's briefing — are never touched by a sync.

---

## Briefings

Opening a character, location, item, or faction page quietly builds that entry's
[Run mode briefing](run-mode.md) in the background if it doesn't have one, so
prepping is also, invisibly, preparing the card you'll want at the table.

The card is read-only here — it's a preview of what Run mode will hand you, not an
editor. If it has someone wrong, fix the description or the Notion page it was
written from and rebuild.

Building costs one Anthropic API call per entry, and only happens when a briefing
is missing. To build them in bulk, or to refresh ones that have fallen behind
their notes, see [Settings → Briefing builds](settings.md).
