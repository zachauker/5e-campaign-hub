# Settings

A tour of the settings page, top to bottom, and what turning each thing on gets
you.

Reach it from the gear at the right of the top bar.

Most sections save as you go. The **Save Settings** button at the bottom covers the
campaign name and the D&D Beyond list; everything else — the vault folder, sync
settings, assistant key, reference library — writes immediately.

---

## General

**Campaign name** renames the active campaign. It's the same name shown in the top
bar and as the dashboard's headline, not a separate label.

To create or switch campaigns, use the selector in the top bar.

---

## D&D Beyond Characters

Your players' character sheets, so the tracker can pull them live.

Add each URL once:

1. Open the character on D&D Beyond.
2. Click **Share**, enabling sharing if prompted.
3. Copy the URL from the address bar.
4. Paste it here and press **Add**.

The app fetches the character immediately and reports what it found — name, level,
race, HP, AC — so you find out a URL is wrong now rather than at the table.
Characters don't need to be public, only shared.

Saved characters then appear under the **D&D Beyond** tab when adding combatants.
See [Encounters](encounters.md#dd-beyond-characters).

---

## Search index

**Rebuild search index** builds what [Run mode](run-mode.md) and the command
palette search — your entities, threads, and clocks.

**Do this once, before your first session.** The index starts empty, so until you
build it, at-the-table search finds almost nothing, which looks exactly like the
feature being broken.

After that it maintains itself. Rebuild again only after restoring a backup or
importing data from outside the app.

---

## Briefing builds

[Run mode](run-mode.md) builds an entity's briefing the first time you look it up
there. That works, but it costs a pause you may not want mid-scene. These build
ahead:

**Build briefings for next session** — everyone and everywhere tangled in an open
thread. This is the one to run during prep; it's targeted and usually cheap.

**Build all briefings** — the whole campaign. Thorough and correspondingly
expensive.

Both skip anything already current and rebuild anything that has fallen behind its
notes, so re-running costs nothing and an interrupted build simply picks up where
it stopped. If a build reports entries remaining, run it again.

**Each entity is one Anthropic API call.** A campaign-wide build on a large
campaign is not free.

---

## Obsidian Vault

Where you point the hub at this campaign's folder in your vault, name the vault for
**Open in Obsidian** links, sync on demand, and turn on automatic background
syncing at 5, 15, 30, or 60 minute intervals. The vault is read-only to the hub.

Full walkthrough: [Vault sync](vault-sync.md).

---

## Assistant

Your Anthropic API key. This one key powers three things:

- The [campaign assistant](assistant.md)
- [Briefings](run-mode.md#briefing-cards) for Run mode
- [Session review](chronicle.md#session-review)

Without it, those three are disabled and everything else in the app works
normally. The key is stored in your database, not in an environment variable.

---

## Reference Library

The rulebooks and lore the assistant is allowed to cite: import the bundled SRD,
ingest PDFs and notes from the server inbox, enable and disable sources, and
annotate each one with how authoritative it is.

Full walkthrough: [Reference library](reference-library.md).

---

## What isn't here

**Campaign creation and switching** — the top bar's selector.

**The in-world date** — [Chronicle](chronicle.md), because it belongs with the
threads and clocks it governs.

**Map pin styling** — the **Pin styles** button on each map, since it's per-map.

**Where data lives** — configured with environment variables at deploy time, not in
the UI. See the [README](../../README.md#configuration).
