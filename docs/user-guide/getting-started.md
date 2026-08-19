# Getting started

What to do the first time you open the hub, and the few things that are worth
knowing before they surprise you mid-session.

---

## Campaigns

Everything in the app belongs to a campaign. The selector sits at the right end of
the top bar; **+ New Campaign** at the bottom of that list creates one.

Your choice is remembered across reloads. Nearly every screen reads it — the
glossary lists, the chronicle, the world map, Run mode — so if a page tells you it
has nothing to show, check the selector before you check anything else.

Two campaigns never touch each other. Separate entities, separate maps, separate
threads and clocks, separate runs.

---

## The top bar

Left to right: **HUB** (back to the dashboard), the section links, the command
palette button, the campaign selector, and the settings gear.

**Run sits last on purpose.** Opening it starts a persisted session, so it's kept
well away from where your hand reaches for Encounters.

One thing the bar does on its own: **while a fight is actually running**, it
collapses to a thin gold line and gives those pixels back to the initiative list.
Move the mouse to the top of the window — or tab into it — and it slides back
down.

---

## The dashboard

`/` shows you the campaign at a glance:

- **A fight in progress**, if there is one, as the first thing on the page with a
  resume link. This is the one piece of state that matters more than the rest.
- **Counts** for characters, locations, items, and factions, each a link.
- **The five most recent encounters.**

---

## The command palette

`⌘K` (`Ctrl+K`) from anywhere.

Type and it searches your characters, locations, items, factions, encounters,
open threads, and clocks, plus a small set of commands like **Advance in-world
date**. Enter opens the highlighted result.

The last row is always **Ask the assistant** with whatever you typed — `⌘↵` sends
it. That row is greyed out until you've added an Anthropic API key in Settings.

The palette searches the same index Run mode uses, which brings us to:

---

## Two one-time setup steps

### Build the search index

**Settings → Search index → Rebuild search index.**

Do this once. The index starts empty, so until you build it, searching in Run mode
and the command palette finds almost nothing — which looks exactly like the
feature being broken rather than a step you haven't taken.

After that it maintains itself as you add and edit things. Rebuild again only if
you restore a backup or import a lot of data from outside the app.

### Set the in-world date

Open **Chronicle**. If the campaign has no date yet, it asks for one before
showing you anything else — threads, clocks, and the timeline are all measured in
in-world days, so none of them mean anything without a starting point.

Enter a day, month, year, and an epoch label (Exandria's is `PD`). You can correct
it later from the same screen without disturbing anything.

---

## Optional connections

None of these are required, and each one only affects its own part of the app.

| Add | In | Unlocks |
| --- | --- | --- |
| **D&D Beyond character URLs** | Settings → D&D Beyond Characters | Live PC sheets in the encounter tracker |
| **A Notion integration token** | Settings → Notion Integration | Page bodies on detail pages, then [full sync](notion-sync.md) |
| **An Anthropic API key** | Settings → Campaign Assistant | The [assistant](assistant.md), [briefings](run-mode.md), and [session review](chronicle.md) |
| **PDFs or notes** | Settings → Reference Library | Grounded, cited rules and lore answers |

---

## Where your data lives

One SQLite file, plus uploaded map images on disk. No account, no cloud, no
sync-to-anything you didn't configure. Backing the app up means backing up that
directory.

The three paid surfaces — assistant, briefings, session review — call the Anthropic
API with your own key. Everything else, including reference-library search, runs
locally.

---

## Where to go next

- Running a fight tonight → [Encounters](encounters.md)
- Running a whole session tonight → [Run mode](run-mode.md)
- Getting your campaign into the app → [Notion sync](notion-sync.md) or
  [the glossary](entities.md)
