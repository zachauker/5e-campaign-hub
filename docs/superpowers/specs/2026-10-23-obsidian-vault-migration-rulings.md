# Obsidian vault migration — rulings made during execution

Sub-project #20. These are the decisions I made while executing
`docs/superpowers/plans/2026-10-23-obsidian-vault-migration.md` where the plan
was silent, self-contradictory, or wrong. The spec was the binding authority.

Each entry is the decision, why I made it, and — where I recorded one — what it
costs if it was wrong, so any of them can be found and reversed. 71 rulings,
in the order made. (The numbering skips R16; no ruling was recorded under it.)

---

### R1

Relation targets resolve basename -> `source_key` through `buildLinkIndex` + `resolveSourceKey`, passed into T7's linkers as a `resolveTargetToKey(target: string) => string | undefined` built once per scan in T8.

**Why:** `buildLinkIndex` had no consumer, and a wikilink target is a basename while 153 of 155 notes are keyed on `hub_id`/`notion_id`, so looking a basename up directly against `source_key` would silently fail to link almost every relation in the vault.

**Cost if wrong:** one extra parameter threaded through five linker functions; the alternative is near-total relation loss, so the asymmetry favors this.

### R2

The `vault_name` settings key is introduced in T13 (added to the settings route allowlist and read with a safe fallback when unset); T14 adds only its UI field.

**Why:** T13 ships `obsidianUri` and the "Open in Obsidian" affordance, and cannot depend on a key a later task creates.

**Cost if wrong:** T14 duplicates a one-line allowlist edit, which is harmless.

### R3

Test bodies shown empty in the plan are specifications of what to assert, not literals. Every implementer dispatch states this, and implementers must write real assertions using the spec's exact values. Reviewers judge tests on their assertions, not on fidelity to the plan's placeholders.

**Why:** transcribing `() => {}` would produce a suite that passes while testing nothing — the exact defect the rubric names.

**Cost if wrong:** none; it only ever adds assertions.

### R4

The app's pinned task list tracks coarse phases rather than one entry per task, because it caps at 12 items and this plan has 17 tasks. This ledger is the authoritative per-task record.

**Why:** the cap is a UI limit, not a planning choice.

**Cost if wrong:** none; the ledger is the recovery map either way.

### R5

The five historical plan docs under docs/superpowers/plans/ that mention lib/notion/test-helpers.ts stay unedited.

**Why:** a past sub-project's plan is a record of what was done at the time, not live documentation; rewriting it to match today's tree falsifies that record.

**Cost if wrong:** a reader of an old plan sees a path that no longer exists, which the git history explains.

### R6

*Context: Task 2: minor (deferred): no index on source_key*

defer, and carry a pointer into Task 7's dispatch, which owns findByKey.

**Why:** adoption-by-key is the sync's hot path, but all five tables together hold ~155 rows, so a scan is immaterial today; Task 7 is the right place to judge it against the real lookup code rather than adding an unused index now.

**Cost if wrong:** a later index migration, which is additive and cheap.

### R7

Task 6 MUST normalize frontmatter date values to an ISO YYYY-MM-DD string, accepting both Date and string inputs and using UTC accessors.

**Why:** gray-matter parses unquoted ISO dates into Date objects, and the real vault writes them unquoted (verified: Session 29 "date: 2026-08-02", a Scene "date: 2026-07-19"); session_notes.date is a TEXT column documented as 'ISO date string "2026-07-19"'. Naive String(d) yields "Sat Aug 02 2026 ..." and local-time accessors can shift the day by one.

**Cost if wrong:** session, encounter and scene dates render as full timestamps or land one day off, silently, on 50 notes. Carried into Task 6's dispatch.

### R8

note.data is read-only for every consumer.

**Why:** gray-matter shares parsed data objects through an internal content-keyed cache; Task 3 bypasses it by passing {} and has a test that fails without it, but a downstream mutation would risk cross-note field bleed.

**Cost if wrong:** one note's frontmatter value appearing on another note. Carried into Tasks 6 and 10.

### R9

resolveCampaignFolder needs no ".." guard of its own.

**Why:** Task 9's PUT /api/vault/source is the only writer of vault_sources.root_path and already rejects absolute paths and ".." segments, and the value is DM-authored locally rather than remote input.

**Cost if wrong:** a hand-edited database row could point the scan outside the vault, which is read-only anyway. Carried into Task 9 to confirm the route guard actually lands.

### R10

Three of Task 3's Minors are upgraded to required additions in Task 8, which owns scan-adjacent error handling, rather than deferred to the final review. (a) scan.ts throws a raw EACCES out of scanVault when a subdirectory mid-walk is unreadable — wrap readdirSync per directory, warn, and continue, matching the per-note isolation rule. (b) Dot-FILES are not excluded, only dot-directories: the vault lives on a Mac and will be served from Unraid, so AppleDouble `._Foo.md` files are a live possibility and would parse as frontmatter-less notes, warning on every tick. (c) scan.test.ts lacks a file-level afterEach(vi.unstubAllEnvs), leaving the VAULT_PATH stub order-dependent.

**Why:** (a) and (b) are container-on-a-network-mount failure modes that the reviewer could only call speculative from the diff, but this deployment makes both concrete; all three are a few lines plus tests.

**Cost if wrong:** Task 8 grows slightly beyond its brief.

### R11

A real basename beats another note's alias in buildLinkIndex (two-pass: index all basenames, then add aliases only where the key is unclaimed). Within each kind, the sorted-first path still wins.

**Why:** this is Obsidian's own precedence, and the DM authors links in Obsidian and sees its resolution; the hub must agree or a relation points somewhere the DM did not intend. No collision exists today, but 19 aliases exist and the set grows, and the failure is silent — a relation quietly bound to the wrong entity.

**Cost if wrong:** one extra pass in an in-memory index build.

### R12

parseWikilink resolves a path-qualified target on its last "/" segment.

**Why:** equivalent to Obsidian's path resolution in a vault with unique basenames (verified: no duplicate basenames), one line, and it turns a silent relation miss into a correct link if the DM ever writes one.

**Cost if wrong:** a path-qualified link to a duplicate basename would resolve by the sorted-path tie-break instead of the written path — no such duplicates exist.

### R13

`![[embed]]` stays out of parseWikilink. Task 10 owns embeds and strips the leading "!" before calling it.

**Why:** embed-vs-link is a markdown-block concern, not a link-parsing one.

**Cost if wrong:** Task 10 duplicates one character of stripping. Carried into Task 10's dispatch.

### R14

Close the lazy-continuation leak even though nothing leaks today.

**Why:** CommonMark and Obsidian treat a non-blank, non-'>' line directly after a blockquote line as a lazy continuation OF that blockquote, so Obsidian renders it inside the collapsed [!dm] callout and the DM reasonably believes it is private. The notes are hand-authored at speed, so zero occurrences is a sample rather than a guarantee, and the failure is silent — DM-only prose entering the search index that a later sub-project's player-facing surfaces will build on.

**Cost if wrong:** a few lines of parser and three tests. Cost of NOT fixing: an unnoticed secrets leak across the one boundary this task exists to hold.

### R15

Keep the implementer's unrequested stripping of Obsidian %%...%% and <!-- ... --> comments from `text`.

**Why:** it removes content from an index rather than adding a feature, both forms are hidden in Obsidian's reading view so the DM does not treat them as prose, and this vault uses HTML comments as layout markers (<!-- Column 1 -->, five pairs) rather than content.

**Cost if wrong:** a search miss on text the DM never sees rendered anyway. Required a code comment marking it deliberate.

### R17

Amend R14: only "-", "*", "+" and an ordered list starting at 1 count as block openers that end a [!dm] block. R14's generic "list item" was too broad and was my error.

**Why:** CommonMark only lets an ordered list interrupt a paragraph when it starts at 1., so "2. secret plan" after a quoted line is a lazy continuation that Obsidian renders INSIDE the callout; treating it as an opener indexed it. Narrowing has no over-strip risk because such a line genuinely belongs to the quote.

**Cost if wrong:** an ordered list the DM intended as a new visible block, written starting at 2, would be stripped from the index.

### R18

Drop DM_MARKER's trailing (?:\s|$) guard despite zero current occurrences of the shape it lets through.

**Why:** the guard was added to exclude [!dmg-roll], but the literal "]" already does that (verified standalone), so removing it has zero over-strip cost; the DM already uses the collapsed [!dm]- form heavily, making [!dm]-Tactics one keystroke away; and the failure is silent — CALLOUT_MARKER then strips the marker, so the secret reaches search_index.body as ordinary prose with no trace of its origin.

**Cost if wrong:** none identified.

### R19

Three hardcoded note_type lists must learn "Exploration Encounter", not one. The plan's Task 17 named only components/maps/marker-meta.ts:31-35 (EVENT_TYPE_META). Found two more by grep: components/maps/marker-layers.ts:19 (EVENT_TYPE_ORDER) with its short labels at :21-25, and components/sessions/SessionNotesBrowser.tsx:17 (TYPE_ORDER). All three are added to Task 17's scope.

**Why:** an unknown note_type falls through to a generic visual and an unsorted group, so the new value would silently render as "other" on maps and sort last in the sessions browser.

**Cost if wrong:** Task 17 grows by two small list edits.

### R20

Accept noteType null for an encounter whose encounter_type is missing or unknown.

**Why:** the two real categories map to different Notion labels (Combat vs RP) and guessing either would mislabel a map pin; null degrades to the generic event visual, which is honest. All 6 real encounters carry an encounter_type, so this is a defensive path.

**Cost if wrong:** one pin shows a generic scroll icon.

### R21

Accept ignoring `found_in` on items. Verified all five items have `found_in: []`, there is no hub table for it, and the spec's item row names only Type and Rarity as displayed properties.

**Why:** YAGNI on an empty field.

**Cost if wrong:** if the DM ever fills found_in, it will not surface until someone adds it — noted here so that is findable.

### R22

source_hash stays body-only, and Task 7's differs() MUST compare the full synced column set rather than the hash alone.

**Why:** digestBody hashes note.body, so a frontmatter-only edit (active true->false, a changed role, a new date) leaves the hash identical. That is correct for a value named "body hash", and briefing staleness is safe because BriefingInputs carries source_props alongside source_hash. The danger is only in reconcile: an implementation that short-circuits on a matching hash would silently drop every frontmatter-only edit. Carried into Task 7's dispatch as a required constraint plus a test (a frontmatter-only change must yield "updated", not "unchanged").

**Cost if wrong:** archived/role/date edits in the vault never reach the hub, silently.

### R23

Accept no index on (campaign_id, source_key). The implementer benchmarked the worst case (500 rows x 2KB text, 1500 missing-key lookups) at 57 ms, the existing idx_*_campaign indexes already narrow each lookup, and the real tables hold ~155 rows. Its added reason is the strongest one: adding a UNIQUE index blind would turn a duplicate key into a failed boot migration, and migrations run on every container start. A later non-unique index is a one-line CREATE INDEX IF NOT EXISTS.

**Cost if wrong:** a slow sync tick, which is background work. This closes R6.

### R24

Task 8 MUST construct a fresh makeEntityRepo per sync run.

**Why:** same-key arbitration (lowest sourcePath wins) uses a per-repo-instance claim map, so a repo reused across runs would read a note moved to a higher path as colliding with its own earlier write.

**Cost if wrong:** a moved note could be treated as a duplicate of itself and skipped. Carried into Task 8's dispatch.

### R25

Task 8 MUST process notes sorted by vault path within each table.

**Why:** the implementer identified an order dependence it cannot remove from reconcile alone — when two different keys compete for one legacy row (a hub_id note and a basename-keyed note sharing a basename), or two notes name-adopt the same unlinked row, the resulting key-to-content set is identical either way but WHICH note inherits the legacy row id depends on processing order. Sorting by path makes that choice stable across ticks.

**Cost if wrong:** an entity id could migrate between two notes on different ticks, moving map pins with it.

### R26

Amend R25. Sorting notes by path makes which-note-wins STABLE but not CORRECT: when two notes share a basename and one carries a hub_id, whichever loses still creates a fresh row where it should have adopted. Task 8 must therefore do a TWO-PASS reconcile — all exact-key matches first, then promotions, then name adoption — in addition to sorting by path (still needed, because two notes name-adopting one unlinked row remains order-sensitive within the final pass).

**Why:** the 3-arg reconcile interface cannot see other notes, so only the caller can order the passes. Latent today at zero duplicate basenames.

**Cost if wrong:** an entity gets a fresh row instead of adopting, stranding its map pins and briefing on the old id.

### R27

Upgrade the reviewer's Minor about reconcile.ts:278 returning a silent `unchanged` on a same-key collision to a required fix.

**Why:** the spec at line 465 requires "Duplicate source_key across notes | Warn once", and with no signal in ReconcileResult that requirement is unimplementable in Task 8.

**Cost if wrong:** duplicate keys resolve silently and the DM never learns two notes are fighting over one entity.

### R28

Task 8 must dedupe collision warnings by source_key.

**Why:** the re-reviewer found the flag fires n-1 times for n notes sharing one key (once per displaced or skipped note), while the spec requires "warn once".

**Cost if wrong:** duplicate warnings per tick for a three-way key collision. Also note the flagged result does not say WHICH path lost (the row's previous source_path is overwritten by then), so the warning should name the key, not the loser.

### R29

PLAN ERROR OF MINE, corrected by the implementer. Accept relations being linked in a FINAL pass after all five tables reconcile, instead of inline in the dependency-ordered loop my plan mandated at line 644.

**Why:** that order came from the Notion design, where the character<->location edge lived on the LOCATION note as a "Notable NPCs" relation. The vault flipped it onto the character note (`location:`) — which my own spec noted — and `parent:` is location->location, so a parent can sort after its child regardless of table order. Inline linking therefore silently dropped every character's location and every location parent on a first sync; the implementer's own first test run caught it. Reconcile, index and archive keep the mandated order.

**Cost if wrong:** none identified; the final pass is strictly more correct.

### R30

REQUIRED FIX: SyncSummary gains a campaign-level bucket.

**Why:** table-less findings (parse failures, unknown/absent `type:`, recognised-skip counts) were being recorded on sessionNotes to avoid 5x duplication, which would render in Settings as "sessionNotes: 3 warnings" for a malformed NPC note — pointing the DM at the wrong place. vault_sources is one row per campaign now, so a campaign bucket is the natural shape rather than an addition, and neither Task 9 nor Task 14 is written yet so there is no retrofit cost.

**Cost if wrong:** a small interface churn in two unwritten tasks.

### R31

Accept that a cross-table type change only archives the old row when another note of the old type survives; otherwise the per-table mass-wipe guard protects it.

**Why:** when a table empties entirely there is no way to distinguish "every note changed type" from "the mount is broken", and protecting rows is correct in that ambiguity.

**Cost if wrong:** in the all-notes-changed-type case a stale row persists until the DM archives it by hand — visible, not silent.

### R32

Accept the unrequested removal of archived rows from the search index.

**Why:** a real bug fix rather than scope creep — the Notion loop left archived entities searchable, so an entity the DM archived would still surface at the table in run mode; the index is derived and rebuildable, and an unarchive re-adds on the next tick.

**Cost if wrong:** an archived entity becomes unfindable in run-mode search, which is the intent.

### R33

Accept the implementer's judgement that the "folder holds no readable markdown" warning stays per-table rather than moving to the campaign bucket.

**Why:** although its cause is campaign-wide, its meaning is per-table — it is the reason THAT table skipped its own archive step, which is what the DM needs to see next to that table's zero counts.

**Cost if wrong:** the same warning repeats across five tables in the panel.

### R34

ANY scan-level incompleteness (an unreadable directory OR an unparseable note) suppresses the archive step and index removal for EVERY table that tick, with a per-table warning. Not table-scoped and not key-scoped, because for a parse failure the note's `type:` is inside the frontmatter that failed to parse, so neither its table nor its tier-1/2 key is recoverable — only its basename. All-table suppression is therefore the only sound option for the likeliest case. scanVault must return structured signals (unreadableDirs, parseFailures), never warning-string sniffing.

**Why the bias:** "I could not read all of your vault, so I will not hide anything" is correct when the alternative is stranding map pins; and this vault syncs between a Mac and a server, so a half-saved file or an Obsidian sync-conflict copy is an everyday event, making the note-level case more likely than the directory case.

**Cost if wrong:** deletions stop propagating until the vault is clean, which the warning explains.

### R35

An unknown or absent `type:` must not archive the note's old row. Push that note's resolveSourceKey key into EVERY table's seenKeys.

**Why:** round 1's Important fix established the invariant "a note that is present but fails to sync must still count as seen", and an unknown-type note is equally present — it just never reaches syncTable because tableForType returns "unknown" first. Honouring the invariant for a failed map but not for a failed route is a distinction nobody would defend. Deliberately NOT R34's all-table archive suppression: a parse failure yields only a path, while an unknown-type note parsed fine so its key IS recoverable — only its table is unknown. Pushing the key into all tables protects its old row wherever it lives at the cost of one harmless key per table, with no collateral.

**Cost if wrong:** a genuinely deleted note whose last edit also broke its type would linger unarchived until the type is fixed. Note this diverges from the Notion loop, which did archive unmappable rows, and from my spec's "mirroring today's no-name warning" — deliberately.

### R36

*Context: Task 8: minor (DEFERRED, declined a third round): only resolveSourceKey(note).key is pushed to unroutedKeys, not candidateKeys(note), so a note that gains a hub_id AND an unknown type in the same tick would not protect its existing row*

not worth a third fix round plus re-review. It needs two simultaneous edits inside one 15-minute tick; the failure is archival (reversible), warned, and self-heals on the next clean sync; and the named one-line fix (push candidateKeys) is available to the final whole-branch review, which will see the whole path at once. Extending a converged loop for this is poor value.

**Cost if wrong:** that one narrow case archives a row until the typo is fixed.

### R37

Accept the three import-line edits inside lib/notion/ (scheduler.ts, scheduler.test.ts, app/api/notion/sync/route.ts) despite the "do not modify lib/notion/" rule.

**Why:** git mv of sync-lock.ts necessarily breaks its importers, and the alternative — duplicating the lock — would create two Sets and defeat the lock entirely. Only import lines changed, no logic. Same precedent as Task 1. Note the Notion scheduler is now dead code: instrumentation.ts points at startVaultSync, so Notion auto-sync no longer runs; the manual Notion route still works until Task 17 deletes it.

**Cost if wrong:** none; Task 17 removes all three files.

### R38

Task 14 must add `vault_auto_sync_enabled` and `vault_auto_sync_interval_minutes` to ALLOWED_KEYS in app/api/settings/route.ts. Until then the UI cannot write the new keys and the legacy read-through is what keeps the DM's saved interval working. Note this stacks with R2, which already requires Task 13 to add `vault_name` to the same allowlist — so between them the allowlist gains three keys and loses notion_token.

**Cost if wrong:** the interval control in Settings silently fails to persist.

### R39

Task 14's panel must handle TWO lastStatus shapes: the nested { tables, campaign } summary on success, and { error: msg } on a mount failure.

**Why:** CampaignSummary deliberately has no `error` field (campaign-level failure throws instead of being recorded), so a failed run cannot be expressed in the summary shape. Accepting the two-shape column rather than widening CampaignSummary, since the panel is the only reader and discriminating on `error` is one check.

**Cost if wrong:** the panel renders a blank status after a mount failure — the one moment the DM most needs to see why.

### R40

Upgrade the reviewer's defense-in-depth Minor to required: validate root_path on the READ path too, in runCampaignSync, not only in the PUT route.

**Why:** this repairs my own R9. I accepted no guard in resolveCampaignFolder on the stated grounds that the route guards it — but the route only guards what IT writes, so a vault_sources row arriving any other way reaches the scan unvalidated and the scheduler would then scan it every tick. The guarantee I traded the deeper guard away for is currently contingent on provenance, which is not a guarantee.

**Cost if wrong:** one extra validation per sync run.

### R41

SPEC GAPS OF MINE, both required. (a) MdBlock gains `checked?: boolean` for GFM task-list items. (b) MdInline gains a `strike?: boolean` mark. Why these outrank their usage counts: both are marks whose loss INVERTS meaning rather than merely dropping decoration. A dropped checkbox state renders every item as unchecked, so a DM's prep list looks undone — and it is a regression against Notion, since NotionBlocks.tsx already has a to_do case with a checkbox and a line-through. A dropped strike renders retracted text as current prose. Grounded against the vault: zero task-list items today (but obsidian-tasks-plugin is installed and [!todo] callouts are already in use, so it is a matter of when), and exactly one strikethrough — in Characters/PCs/Bramblerose Toadfoot.md, a type: pc note, so it IS mirrored and WILL render, and it is a question the DM struck out, so rendering it live inverts its meaning.

**Cost if wrong:** two optional interface fields.

### R42

content-here stays an ALLOW-list, upheld on the reviewer's reasoning rather than the implementer's. The decisive argument is one neither I nor the implementer had: session_notes is ALSO fed by the Notion sync, so under a deny-list any Notion-synced row with a blank or unrecognised Type, linked to a location, would be admitted as "content" — likelier than the R20 case and plainly wrong. Note the reasoning shifts after Task 17: once Notion is gone the table is vault-only and NULL comes only from R20, which would make a deny-list more faithful. The allow-list is safe either way, so it stands, with a comment explaining the trade rather than asserting the behavior. The real fix if it ever bites is a source discriminator on the row.

**Cost if wrong:** an encounter with an unmapped encounter_type is missing from one embed list; zero live rows.

### R43

Accept the guard's deviation from my instruction, which is better than what I specified. I said reject a path.relative result that "starts with ..". It compares by path SEGMENT instead (rel === ".." or starts with ".." + sep), because the literal rule would reject a legitimate file named "..weird.png".

**Cost if wrong:** none identified.

### R44

Accept no index cache for attachment resolution, on measurement rather than assertion. The implementer judged a full vault walk per request acceptable; I measured the real vault: 2103 entries total (D&D 823, Day Planner 902, Archive 141, the rest small) and a full walk completes in ~9ms warm. With Cache-Control immutable the walk happens once per image per browser cache lifetime.

**Cost if wrong:** slower first paint on a cold cache over a network mount; an index with a TTL is the fallback.

### R45

Accept the three remaining concerns. (a) No TOCTOU defence between guard and open: exploiting it needs write access to a mount the hub holds read-only. (b) No committed route test: structural, since vitest covers only lib/ and components/, and the logic that matters lives in the tested lib/ module — the implementer smoke-tested the route and deleted the throwaway file. (c) Directory symlinks are not followed, so an attachments folder the DM symlinks in would be invisible; the safer default, and it matches the note scan.

### R46

Correct my own R43 rationale. I accepted the segment-wise parent check on the grounds that a literal "starts with .." rule would wrongly reject a file named "..weird.png". That reasoning is unreachable: resolveAttachment rejects any target beginning with "." before the guard runs, so the test for it exercises a scenario the route cannot produce. The behaviour is still correct — the REAL reason segment comparison beats prefix comparison is the sibling-directory case (a "vault-evil" folder next to "vault"), which IS reachable and IS tested. Only the comment changes.

**Cost if wrong:** none; a misleading comment invites someone to "simplify" the guard back to a prefix check.

### R47

Accept the in-module concurrency limiter over sharp.concurrency(1), which I had suggested. The implementer identified that sharp.concurrency is process-global and would also throttle map tiling in lib/maps/storage.ts. Better judgement than my suggestion.

**Cost if wrong:** a hand-rolled semaphore is a new failure surface, which is why the re-review is checking its error path specifically.

### R48

PLAN GAP OF MINE: wikilinks must navigate. The implementer called it out of scope, reasonably, because my Task 13 brief omitted it — but the spec says plainly "A link to a mirrored note renders as an internal hub link to that entity; a link to a skipped type renders as plain text, not a dead link." Required because there are hundreds of wikilinks in note bodies and inert styled text shows the link while refusing to follow it; with the embeds already live, this is what makes the hub navigable rather than merely readable. Resolution must NOT scan the vault per page view: mapNote sets a row's `name` from the note basename and a wikilink target IS a basename, so it is a case-insensitive match against `name` across the five tables — no index, no filesystem. Accepted degradations: alias links never resolve (aliases are frontmatter-only and never reach the DB) and render as styled text, which the spec's own rule permits; a cross-table name collision needs a deterministic winner.

**Cost if wrong:** one extra lookup pass per page render.

### R49

Accept the implementer's narrowing of the page route: it serves only paths that some hub row was synced from, 404ing unsynced notes, _Templates and dot-directories. Better than my spec's "reads the file under VAULT_PATH" — no arbitrary file under the vault is readable even with a valid relative path, and the hub only renders notes it actually synced. Strictly tighter, no capability lost.

### R50

PLAN GAP OF MINE: Task 17's decommission list was badly incomplete. I grepped: 37 files still reference Notion. Missing from my list were lib/entities/entity-list-view.ts (+test), components/entities/{CharacterFormDialog,SimpleEntityFormDialog,SimpleEntityManager,entity-quick-view-model}, components/glossary/SimpleEntityDetail, app/api/{characters,factions,items,locations,sessions} list and detail routes, app/api/briefings/{route,batch}, app/api/campaigns/[id]/state/review/status, app/api/world/import-locations, lib/run/{briefing-agent,briefing-batch}, and lib/state/content-hash. All added to Task 17's scope.

**Cost if wrong:** Task 17 is substantially larger than planned, and may warrant splitting.

### R51

Accept HubKind/hubHref alongside EmbedItemKind rather than unifying them. The implementer flagged that factions needed a `faction` kind EmbedItemKind lacks, added HubKind covering all five, and made embedItemHref delegate to hubHref. The sets genuinely differ: no Related.base view returns a faction as a RESULT (Members is pc/npc filtered BY faction), so EmbedItemKind's four values are the real range of embed items while HubKind's five are the real range of hub entities. Two types with distinct meanings and one shared href function.

**Cost if wrong:** a reader may mistake them for duplication; the comment should say why they differ.

### R52

Fix the external-markdown-image regression despite zero live occurrences. markdown.ts puts a plain markdown image's URL into the same imageTarget field as a vault attachment, and resolveAttachment matches on BASENAME only, so ![art](https://example.com/art.png) either 404s or serves whichever in-vault file is named art.png.

**Why fix:** the wrong-file outcome is worse than a broken image and gives no signal it happened, pasting a markdown image from a web page is an unthinking act, and the old renderer used imageUrl directly so this is a regression.

**Cost if wrong:** two lines in one case plus two tests.

### R53

Upgrade the reviewer's EventNoteBody Minor to required. MarkerSlideOver renders EventNoteBody unkeyed so it is reused across markers, and the !marker.entityId branch returns without clearing detail — so clicking a pin with no note shows the PREVIOUS pin's note under "Session note not found." Showing one note's content beneath another note's heading is a wrong-content bug, not cosmetic. One line.

### R54

Accept the unruled "None." rendering for an embed that resolves to zero items. The ruling covered an ABSENT map entry (renders nothing); an answerable-but-empty view is different, and a heading with "None." under it tells the DM the relation is genuinely empty where blank space would read as a bug.

### R55

Upgrade two of Task 14's Minors to required. (a) saveVaultName and saveAutoSync use try/finally with no catch, so a rejected fetch is an unhandled rejection with no toast, and saveAutoSync updates optimistically with no rollback — so the panel can show auto-sync "off" while the server has it on. This is the same "a setting silently fails to persist" class the reviewer itself called Important elsewhere in this task, and the DM has no way to tell. (b) Changing the folder leaves the previous folder's lastStatus displayed, so the panel shows "Folder found" and the OLD counts under the NEW path until the next sync — actively misleading in the one surface whose job is diagnosis. Fix by clearing the displayed status on a successful path save; do not change what the server stores.

**Cost if wrong:** a little extra handler code.

### R56

Task 17 must also move app/api/campaigns/[id]/state/review/status/route.ts onto readNoteText and source_path, AND reconcile the hash basis. Verified: it still imports fetchNotionPageBlocks, reads notion_token, and returns reviewable:false when notionPageId is null — so for a vault-backed note the UI will not offer review at all, making Task 15's work unreachable until 17 lands. Worse, it hashes NOTION text while the review route now stores a hash of VAULT text, so the two can never match and needsReview would be permanently wrong even once both work.

**Cost if wrong:** session review silently unavailable, or permanently claiming a session needs re-review.

### R57

Task 17 must feed BRIEFINGS the raw note body, NOT source_text. Verified at lib/run/briefing-agent.ts:55-56: the agent is handed inputs.notionBody, the FULL page body, and it generates entity_briefings.secret, the field documented as "DM-only. Never indexed for search." Substituting the [!dm]-stripped source_text would silently strip the very material that field exists to hold, degrading briefings while every test still passed. My plan said only "hash from source_hash" and never specified what the agent receives.

**Cost if wrong:** briefing secrets quietly become non-secret.

### R58

SPLIT Task 17 into 17a (substantive rewiring) and 17b (mechanical decommission). My plan flagged it might warrant splitting and R50 then tripled its file count to ~37. The split follows the shape of the work: 17a carries three changes that need judgement and tests (the briefing body source under R57, the review STATUS route under R56, and the three note_type order/icon lists under R19), while 17b is same-shape mechanical work — delete lib/notion and app/api/notion, drop @notionhq/client, rename the remaining notionProps/notionUrl consumers, rewrite the docs, and run the final verification. 17a runs first, while the Notion code still exists as a reference for what the replaced behaviour was.

**Cost if wrong:** one extra review cycle.

### R59

Task 16 (the vault pre-flight) is NOT mine to execute. Two reasons, the second decisive. (a) It edits the DM's live Obsidian vault — his campaign data, on a machine where Obsidian may be open — which is an outward-facing side effect outside this worktree that norms say I ask about first; the plan being approved does not make it my call to start editing his notes. (b) It is not actually possible from here: step 2 requires reading each note's id from the LIVE database on Willowbrook so the frontmatter matches, and I can only see a local dev DB whose ids are freshly generated UUIDs. For "Shale Telenna (Hill)" specifically the basename will not match its hub row (likely named "Shale Telenna"), so adoption needs either the production notion_page_id or a rename — and I cannot determine which without production state. Plan: do 17a and 17b, then hand the DM precise instructions with the exact commands and the specific unknowns named.

### R60

KEEP the implementer's unrequested sentence in BRIEFING_SYSTEM ("a [!dm] callout is raw material for `secret` and must never go in partyKnows"), and record why it is not scope creep: it closes a leak path MY R57 ruling opened. Verified at lib/run/search-index.ts:160 — the indexed body is [identity, wants, partyKnows], while :155 documents that `secret` is deliberately never written. So feeding the agent raw bodies (necessary, or `secret` is hollow) creates a new route by which [!dm] material could reach the search index, if the model places it in partyKnows. The sentence is the mitigation.

**Cost if wrong:** a prompt line nobody needed.

### R61

REQUIRED: make `partial` an input to briefing staleness. The reviewer found that a partial card can never rebuild itself: it stores a hash derived from the ROW's source_hash, which is unchanged when the mount returns, so isStale is false, selectBuildTargets skips it, and the API reports stale:false. The DM keeps a card whose `secret` was written from no note at all, permanently. The shape is pre-existing, but the TRIGGER changed under this task from "one Notion page had a bad day" to "the vault wasn't mounted", which hits every card at once — and this task redefined what partial means, so it owns the consequence.

**Cost if wrong:** partial cards rebuild on every pass until their note has prose.

### R62

REQUIRED: add a verbatim backstop dropping any briefing field containing a [!dm] marker from the indexed body, with a console.warn so it is diagnosable.

**Why, and its honest limit:** the [!dm] -> partyKnows barrier is instruction-only, and while this is NOT a regression (the old agent received the whole Notion page equally unstripped), the material is now explicitly LABELLED behind-the-screen text, which raises what a paraphrase costs. The backstop catches verbatim copying, the mechanically detectable failure mode; it does NOT catch paraphrase, and the comment must say so rather than let a reader assume the hole is closed. Consistent with how this project has treated the [!dm] boundary throughout.

**Cost if wrong:** a field containing a literal "[!dm]" in legitimate prose drops out of the index, logged.

### R63

Accept explicitly that `partial` also trips for a readable-but-empty body, which is wider than my own sentence. A frontmatter-only note leaves the card equally uninformed, so the badge is honest. Noted that it interacts with R61: such a note will now rebuild on every pass. If noisy, narrow partial to the catch branch rather than undoing R61.

### R64

MY OMISSION, now required: the original task-17 step 5 (docker-compose.yml /vault:ro mount + VAULT_PATH env, and a DEPLOYMENT.md section) fell out when I split the task into 17a/17b. Without it the container cannot find the vault at all, so it is not tidying. The DEPLOYMENT.md section must also record the spec's one open prerequisite — that what syncs the vault onto the server is still unresolved — so a reader learns it there rather than by debugging an empty hub.

### R65

Required: strip the dead notion_* columns from the five entity routes' list and detail responses. They spread the DB row, so notionProps/notionUrl still ship to the client, and notionProps is now the raw JSON string rather than the parsed array it used to be (the parse went away). Nothing reads them, but a task whose purpose is removing Notion should not leave Notion-shaped fields in its API responses, and a silently changed shape on an unread field is what confuses the next reader. The COLUMNS stay in the database per the additive-only convention.

### R66

ACCEPT the implementer's deviation from my own compose snippet, which prevented a real deployment failure. I gave a literal `/mnt/user/<path-to-vault>` placeholder; it used `${VAULT_HOST_PATH:-./vault}` instead, because scripts/update.sh does `git pull` and its header says it "Syncs docker-compose.yml (in case it changed)" — I verified both. So my placeholder would have been deployed verbatim to Unraid and silently bound an empty directory literally named `<path-to-vault>`, and every sync would have reported no readable notes with nothing pointing at the cause. The env-var form needs VAULT_HOST_PATH set in a .env beside the compose file on the host.

**Cost if wrong:** an unset variable falls back to ./vault, which also yields no notes — but diagnosably, and DEPLOYMENT.md says so.

### R67

SECURITY DEFECT CAUSED BY MY OWN INSTRUCTION. I told Task 17b to remove notion_token from MASKED_KEYS as dead cleanup. It is not dead: GET /api/settings reads EVERY settings row and masks only keys in MASKED_KEYS, and it cannot be restricted to ALLOWED_KEYS because VaultSyncPanel depends on the legacy notion_auto_sync_* keys coming back. So with the mask removed, a database still holding a notion_token row returns the token's CLEAR-TEXT value in the settings JSON where it previously returned "configured" — and the production database is one that synced 132 entities from Notion, so that row is very likely present. Nothing in the UI displays it, which is exactly what would have kept it quiet. Restore the string; leave ALLOWED_KEYS alone so the key still cannot be written.

**Cost if wrong:** one string, and a mask for a feature that no longer exists.

### R68

Required: fix DEPLOYMENT.md:169-170, which describes a failure the code does not produce. An unset VAULT_HOST_PATH gives an empty ./vault, and with a campaign folder configured assertFolderReadable throws VaultUnreadableError -> 503 -> "The vault folder isn't reachable from the server" — NOT the "found no readable notes" warning, which only fires when the campaign folder exists and is empty. The section's own third bullet already states the real behaviour, so the page contradicts itself and would send a reader hunting for a message that never appears.

### R69

MY THIRD INSTRUCTION ERROR, caught by the implementer. I told it the pre-flight could say "or rename the note to match the hub row". It cannot: the backfill fills source_key from notion_page_id, and findByNameUnlinked only matches rows where source_key IS NULL, so a renamed note still creates a duplicate and still archives the original. The implementer left it out and documented notion_id only. Had it complied, the DM would have followed a documented instruction and lost a PC's map pins.

### R70

Accept the implementer widening Fix 4 beyond the brief to cover symlinked .md notes and dangling links. Same silent-skip-then-archive shape as a symlinked directory; the guard is incomplete without it. My scoping was too narrow.

### R71

Accept the tier-3 belt warning's false-positive case (a new basename-keyed note landing in the same pass as a genuine deletion). A hedged false positive on the one destructive outcome is the right side to err on.

### R72

REQUIRED CORRECTION TO MY OWN FIX 3, verified live: index description AND source_text, not body-in-preference-to-description. My wording said "pass source_text as the indexed body, falling back to description when empty", which the implementer followed literally — but 38 entities in the real vault carry BOTH a frontmatter description: and substantial body prose holding different text (King's Bastion, Shimmer Ward, Mosaic Ward, Old Maren's Shrine among them). Under the literal reading every one of those descriptions becomes UNSEARCHABLE — so a fix whose whole purpose was adding searchable text would have silently removed some, invisible until a search at the table returned nothing.

**Cost if wrong:** a slightly longer indexed body per entity.

