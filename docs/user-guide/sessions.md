# Sessions

Your session notes, pulled from Notion and wired into the rest of the campaign —
the places they happened, the pins on the maps, and the threads and clocks they
moved.

Open **Sessions** in the nav.

This section is entirely fed by [Notion sync](notion-sync.md). Point the
**Session Timeline** database at it and sync; until you do, the page will tell you
so and nothing else.

---

## The list

Notes are grouped by their Notion **Type**, in the order they're usually useful:

**Story Outline** · **Session Notes** · **Character Event** · **Combat Encounter**
· **RP Encounter**

Anything with a type you don't use, or none at all, collects under
**Uncategorized**. Each row shows the note's status and date.

Notes that vanished from Notion are archived rather than deleted — the count sits
at the top right — so a pin or a thread pointing at one never breaks.

---

## A note's page

**The Notion page body**, rendered in full: headings, lists, callouts, toggles,
tables. This is your actual prose, in the app, next to everything else.

**Settings** — the locations this note is linked to, each a link through. Matched
from the note's *Setting* property in Notion against your location names.

**Pinned on** — every map carrying a pin for this note, each jumping straight to
that pin. See [event pins](maps.md#session-notes-on-the-map).

**Notion properties** as a table, and a link back to the original page for when
you want to edit rather than read.

---

## Pinning a session to the world

The point of an event pin is that a year later you can look at the map and see
where things happened.

The fast way is from the map side: open a map, pick a date in the filter, and the
**unpinned notes tray** at the bottom lists that session's notes that aren't on any
map yet. Click a note, click the spot. It disappears from the tray, which turns the
tray into a checklist.

Full details in [Maps → Session notes on the map](maps.md#session-notes-on-the-map).

---

## Session review

The **Review session** button appears on any note with a linked Notion page. It
reads what you wrote and proposes updates to your campaign state:

- **Open a thread** the session raised, already linked to the characters,
  locations, and factions involved
- **Resolve a thread** the session answered
- **Tick a clock** the session advanced
- **Advance the in-world date**, if the notes say time passed

Every proposal carries **the line from your notes that prompted it, quoted
verbatim**. That isn't decoration: a quote that isn't literally present in your
notes is rejected before you ever see it, so a proposal built on something the
model imagined doesn't reach the screen. Approve what you want; ignore the rest.
Nothing is applied until you say so.

A note that has changed since its last review shows a dot on the button, so you can
tell "not reviewed yet" from "reviewed, then rewritten".

This is the main way threads and clocks stay current without you maintaining them
by hand. It uses your Anthropic API key and costs one model run per review — the
full walkthrough is in [Chronicle → Session review](chronicle.md#session-review).

---

## Editing

Session notes are read-only here. They're Notion's, and the next sync would
overwrite anything you changed. Write in Notion; read, link, pin, and review here.
