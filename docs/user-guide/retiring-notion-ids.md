# Retiring the Notion identity layer

Your notes are still recognised by the `notion_id:` they carried over from Notion.
That works, and nothing is broken — but it means the hub's identity for 130 of your
notes is a Notion page id, and you can't rename or reorganise freely without thinking
about it. This is the one-time procedure that moves them onto `hub_id:`, which is yours.

**This is optional.** Nothing here is required for the vault sync to work. Do it when
you want to be free of the Notion keys, not before.

---

## The one rule that matters

> **Add `hub_id:`. Keep `notion_id:`. Never do both edits at once.**

If a note gains a `hub_id` and loses its `notion_id` in the same edit, the sync cannot
find its existing row. It creates a fresh one and archives the old — taking that row's
map pins, thread links and briefing with it.

**Why.** The sync looks the note up by its resolved key (`hub_id`) and misses, because
the row is still keyed on its Notion id. It then tries the note's other candidate keys
in order — and `notion_id` is the one that finds the row, at which point the row's
`source_key` is rewritten to the new `hub_id` in place, with everything still attached.
Remove `notion_id` and the only candidate left is the file name, which matches nothing;
name-based adoption only claims rows whose `source_key` is empty, and the first deploy
filled it in from `notion_page_id`. So the lookup falls through to "create".

Keep both for one sync. After that the `notion_id` is dead weight and safe to drop.

## Before you start

1. The **first-sync pre-flight** in `DEPLOYMENT.md` must be done. Two notes have no id
   at all (`Arcs/Dangerous Designs Pt 1.md`, `Characters/PCs/Shale Telenna (Hill).md`),
   and they need their production `notion_page_id` before anything else happens.
2. **At least one successful sync** must have run, so you can verify adoption before
   you remove anything.

## Scope

Only notes whose `type:` maps to a hub table need a `hub_id`. As of 2026-11-04 your
campaign folder holds 157 notes:

| Needs a `hub_id` | Count | Doesn't need one (`SKIPPED_TYPES`) | Count |
|---|---|---|---|
| `npc` | 34 | `thread` | 17 |
| `location` | 33 | `player-note` | 5 |
| `session` | 30 | `reference` | 2 |
| `pc` | 8 | `campaign` | 1 |
| `faction` | 8 | | |
| `encounter` | 6 | | |
| `scene` | 5 | | |
| `item` | 5 | | |
| `arc` | 3 | | |
| **total** | **132** | **total** | **25** |

The 25 skipped notes never reach a hub table, so a `hub_id` on them does nothing. Adding
one is harmless, just pointless. Note that 23 of them still carry a vestigial
`notion_id` that has never been read.

## Step 1 — choose the key

**Use the file name, without `.md`.** All 157 basenames in your vault are currently
unique, so it collides with nothing, and it stays readable in the frontmatter.

Two things to know about `hub_id`:

- It is matched **verbatim** — no normalising, unlike `notion_id`, which has its dashes
  stripped before comparison. Spaces, capitals and parentheses all have to match exactly.
- Once it is set, **renaming the file is free forever.** That is the whole point: the id
  stops being the name.

Re-check uniqueness before you run, since you've added notes since this was written:

```bash
cd "/Users/zacharyauker/Documents/Willowbrook-Remote/D&D/Explorers of Exandria" && \
  find . -name '*.md' -not -path '*/_Templates/*' -not -path '*/.*' \
    -exec basename {} .md \; | sort | uniq -d
```

Any output is a duplicate basename — give those two notes distinct `hub_id` values by
hand rather than using the file name.

One more check, since the value goes into YAML. A name containing `: `, or starting with
a character like `-` or `#`, has to be quoted (`hub_id: "..."`) or the frontmatter will
not parse — and a note whose frontmatter fails to parse suppresses archiving for the
whole sync, so you would see it, but only as a warning:

```bash
cd "/Users/zacharyauker/Documents/Willowbrook-Remote/D&D/Explorers of Exandria" && \
  find . -name '*.md' -not -path '*/_Templates/*' -not -path '*/.*' \
    -exec basename {} .md \; | grep -nE ': |^[-#]'
```

Those two are what actually turns up in note titles; other YAML metacharacters
(`&`, `*`, `|`, `>`, `%`, `@`, a leading quote or bracket) need quoting too, so if a name
looks exotic, quote it and move on.

Checked on 2026-11-04: no output, and all 157 basenames were unique. Both checks are
worth re-running, since you have added notes before.

## Step 2 — see what would change (read-only)

This prints the edit for each note and writes nothing:

```bash
cd "/Users/zacharyauker/Documents/Willowbrook-Remote/D&D/Explorers of Exandria" && \
  find . -name "*.md" -not -path "*/_Templates/*" -not -path "*/.*" -print0 \
  | xargs -0 grep -lE "^type: *[\"']?(npc|pc|location|item|faction|session|arc|encounter|scene)[\"']?[[:space:]]*$" \
  | while IFS= read -r f; do \
      grep -qE "^hub_id:" "$f" && continue; \
      echo "would add  hub_id: $(basename "$f" .md)   -> $f"; \
    done
```

Expect 132 lines the first time, and none once step 3 is done.

## Step 3 — add the `hub_id`

Make the edit in Obsidian, with your vault skills. **The hub cannot do this**: the vault
is mounted read-only by design and the hub never writes to it.

For each note in the step-2 list, add one frontmatter line, leaving `notion_id` alone:

```yaml
---
type: npc
hub_id: Elbera Duskriver
notion_id: 44635468a1b24c0e9f1e2d3c4b5a6978
---
```

## Step 4 — sync, then verify every row adopted

Run a sync. The report should show adoptions, **no archives**, and no warnings.

Then check that no row is still keyed on a Notion id. On the Unraid host, from the
deploy directory:

```bash
sqlite3 data/encounter-tracker.db "
  SELECT 'characters' t, COUNT(*) FROM characters
    WHERE archived = 0 AND source_key GLOB '[0-9a-f]*' AND LENGTH(source_key) = 32
  UNION ALL SELECT 'locations', COUNT(*) FROM locations
    WHERE archived = 0 AND source_key GLOB '[0-9a-f]*' AND LENGTH(source_key) = 32
  UNION ALL SELECT 'items', COUNT(*) FROM items
    WHERE archived = 0 AND source_key GLOB '[0-9a-f]*' AND LENGTH(source_key) = 32
  UNION ALL SELECT 'factions', COUNT(*) FROM factions
    WHERE archived = 0 AND source_key GLOB '[0-9a-f]*' AND LENGTH(source_key) = 32
  UNION ALL SELECT 'session_notes', COUNT(*) FROM session_notes
    WHERE archived = 0 AND source_key GLOB '[0-9a-f]*' AND LENGTH(source_key) = 32;"
```

**Every count must be zero before you go on.** A non-zero count means some note's
`hub_id` did not match, and its row is still on the old key. Find it, fix the
frontmatter, sync again. Do not proceed while any count is above zero.

## Step 5 — remove `notion_id`

Only once step 4 reads all zeros. Delete the `notion_id:` line from the notes (the 23 on
skipped-type notes can go at the same time; nothing ever read them).

Sync once more. Expect **no adoptions and no archives** — every note should come back
`unchanged` or `updated`. If anything is adopted or archived at this point, a note lost
its identity: restore its `notion_id` from your git history and work out which key missed.

## What can then come out of the code

Each of these is gated on the check beside it. None is urgent.

| Code | Safe to remove when |
|---|---|
| `notion_id` tier-2 read in `lib/vault/map.ts` | Step 5 done and step 4 still reads all zeros |
| `source_key` backfill in `lib/db/migrate.ts` | Every row has a non-null `source_key`. It is idempotent and already a no-op, so removing it is cosmetic — and keeping it protects you if you ever restore an old backup |
| `notion_auto_sync_*` fallback in `lib/vault/scheduler.ts` | `SELECT * FROM settings WHERE key LIKE 'vault_auto_sync%'` returns rows, meaning the new keys have been written at least once |
| `notion_token` in `lib/settings-mask.ts` | `SELECT COUNT(*) FROM settings WHERE key = 'notion_token'` returns 0. **Recommended: keep it regardless.** It costs nothing, and without it that row — if one ever exists — comes back in clear text from `GET /api/settings` |
| `lib/entities/legacy-columns.ts` | Never. The `notion_*` columns stay in the database by house rule (migrations are additive-only), and this is what keeps them out of API responses |

**The realistic end state is not zero mentions of Notion.** The columns stay forever,
`legacy-columns.ts` stays to keep them out of the API, and the token mask is cheap
insurance worth keeping. What this procedure removes is the *identity dependency* — the
part that actually constrains how you name and organise your notes.
