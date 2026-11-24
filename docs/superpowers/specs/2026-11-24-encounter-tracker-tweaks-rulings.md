# Encounter tracker tweaks — rulings

**Date:** 2026-11-24
**Design:** [2026-11-24-encounter-tracker-tweaks-design.md](2026-11-24-encounter-tracker-tweaks-design.md)
**Plan:** [../plans/2026-11-24-encounter-tracker-tweaks.md](../plans/2026-11-24-encounter-tracker-tweaks.md)

Decisions taken during execution without stopping to ask, each with what it
costs if it was the wrong call. Listed in the order they were made. The
whole-branch reviewer audited all 22 and disagreed with four — those are
marked **[disputed]** with the reviewer's position, since they are the most
likely to be worth reworking.

## Pre-flight

1. **Task 7 also modifies `EncounterControls.tsx`.** The plan listed four
   files, but a third consumer of `showStatBlock` existed: the `s` shortcut,
   which opened the stat block for the combatant whose turn it is. Removing
   the store member without it was a compile break. The shortcut now calls
   `selectCombatant(currentId)`.
   *Cost if wrong:* `s` expands the row as well as showing the sheet. That
   matches the merged selection model, so the risk is cosmetic.

2. **In `tokenIndexOf`, an ordinal read from the name wins; position is only
   the fallback.** The plan's own tests contradicted each other; this is what
   makes both pass, and it stops survivors renumbering when a creature dies.
   *Cost if wrong:* badge numbers drift from names after a mid-fight removal.

3. **Absence of component unit tests is not a defect in this project.**
   `vitest.config.ts` runs the node environment over `.ts` only, so no `.tsx`
   test can run. Logic worth testing was pushed into `lib/` modules instead.
   *Cost if wrong:* a reviewer waves through a component defect a test would
   have caught. Mitigated by per-task browser verification.

## Duplicates (Task 2)

4. **A position fallback colliding with a named member's ordinal is a real
   defect, fixed before review.** Initiative re-sorts rows on every change, so
   `[Goblin 2, Zed]` gave both members badge 2 and nothing badge 1.
   *Cost if wrong:* badge numbers stop matching name ordinals in hand-renamed
   groups — still unique, so cosmetic.

5. **The palette ships as-is despite indigo sitting near blue and violet.**
   The 8th colour only appears in a group of 8+ copies, where the number and
   name still disambiguate, and every substitute inside the allowed hue space
   (no green, amber, red or gold — those already mean health and turn order)
   lands equally close to something else.
   *Cost if wrong:* in an 8+ copy fight two stripes look similar.

6. **Colour repetition past 8 copies is accepted** — the plan specifies
   wrapping. *Cost if wrong:* a 9th copy shares colour 1's stripe.

7. **The plan's `planAdd` interface was the defect, not the code.** It could
   express neither "a lone creature keeps its sheet colour" nor "copy #1 is
   recoloured when a group forms, even if hand-renamed". `color` became
   nullable and `renameFirst` became `updateFirst`, whose null name means
   recolour without renaming.
   *Cost if wrong:* a wordier return shape; no behaviour depended on the old
   names.

8. **`tokenIndices` added to that interface** so a list render computes every
   badge in one pass instead of rebuilding groups per row.
   *Cost if wrong:* one extra exported function.

9. **A colourless duplicate group draws badges but no left stripe.** The badge
   alone distinguishes the copies; an uncoloured stripe would be invisible.
   *Cost if wrong:* a legacy group is distinguished only by its numbers.

10. **A group shrinking leaves the survivor its token colour.** Recolouring on
    removal would make colours shift mid-fight, which is what ruling 2 exists
    to prevent. *Cost if wrong:* a lone survivor shows a stripe that looks like
    a sheet-authored colour.

## Sheet conversion (Task 3)

11. **`applySheetEdits` returns the full save set, not "only changed fields".**
    The plan's phrasing contradicted its own test, which needs an unchanged
    `hpCurrent` in the result.
    *Cost if wrong:* a few unchanged fields are spread onto the combatant — a
    no-op.

12. **The round-trip dropping `version`/`tags`/`notes` is not a defect**,
    because the library PATCH merged at the time and `JSON.stringify` drops
    undefined keys. *Superseded by ruling 18*, which changed PATCH to replace
    and pushed the merge onto the save-back caller.

13. **Sheet `notes` has no combatant field, and that is intended.**
    `combatants.notes` is per-fight scratch; sheet notes persist only on
    save-to-library. *Cost if wrong:* prep text is unavailable mid-fight — which
    is why the tracker's editor hides the field rather than showing an empty one.

14. **Speed written to the flat column while `statBlock.speed` kept its stale
    string is a real breach of the write-both rule**, fixed with a test.
    *Cost if wrong:* the row and the sheet disagree about a creature's speed.

15. **`statBlock.spellcasting` promoted from a deferred minor to a fix.** It was
    the only `StatBlock` key with no sheet field, so the first mid-fight
    save-back discarded every spellcaster's spell text.
    *Cost if wrong:* one more optional sheet field and one more editor input.

16. **An edit whose sheet has no `statBlock` still nulls an existing one.**
    Correct for a bare NPC; the guard against losing a real block was pushed
    into the editor, which keeps a block present when its source had one.
    *Cost if wrong:* a creature's stat block is cleared by an edit that meant
    to clear only a field.

## Row and editor (Tasks 5, 8)

17. **The row ships at 91px against the plan's ~86px estimate.** **[disputed]**
    The figure was taken off the mockup and the built geometry matches it
    exactly. *The whole-branch reviewer's position:* the anti-goal is written in
    rows visible, not pixels, and nobody re-derived that number — 8 of 13 rows
    at 1680×900 against ~11 before. See the hand-off note; this is the open
    design question.
    *Cost if wrong:* big fights scroll more than the design intended.

18. **Two Speed fields collapsed into one free-text field.** "Speed (ft.)" and
    "Speed text" wrote different places and `characterUploadToCombatant` let
    the text win, so editing the number did nothing — and the library save path
    never calls the function that fixed this elsewhere.
    *Cost if wrong:* a DM cannot set a numeric speed that disagrees with the
    printed text, which is the point.

19. **The editor's extra `imagePath` / `onPortraitChanged` props are accepted** —
    the Portrait tab cannot preview, replace or remove an upload without them.
    Hosts must pass `key={entryId}`, since the editor seeds internal state once.
    *Cost if wrong:* a host that forgets the key shows the previous entry's data.

## Library writes (Tasks 9, 10)

20. **`PATCH /api/library/[id]` replaces `data` instead of merging it.**
    **[disputed]** The merge made it impossible to clear a field — the DM
    cleared Notes, saved, and the old text came back. *The reviewer's position:*
    right call, but the "always send a complete sheet" invariant is now
    enforced only by convention across three `.tsx` callers with nothing on the
    server checking it; it should sit behind one tested helper.
    *Cost if wrong:* a caller that PATCHes a partial sheet loses the omitted
    fields.

21. **Deleting a library entry must null its references first.** **[disputed]**
    `library_id` and `stat_sheet_id` were added with no `ON DELETE` clause while
    `foreign_keys = ON`, so deleting an in-use entry returned 500 — a regression
    this branch introduced. *The reviewer's position:* right diagnosis,
    under-scoped fix — the client store still held the dead id, which wedged
    every later encounter save. That second half was found and fixed in the
    final wave.
    *Cost if wrong:* deleting an in-use entry orphans a combatant's link.

22. **The pane's stat block title shows the sheet's name while the row shows
    the entity's** ("Bandit Captain" vs "Grik"). Deferred to the user rather
    than decided: cosmetic, and there is a real argument each way.
    *Cost if wrong:* a DM clicking "Grik" reads "Bandit Captain" at the top of
    the pane.

Two further rulings were bookkeeping rather than design: accepting that the
portrait upload could only be driven by setting a `File` on the input through
JS (browser tools cannot open an OS file picker), and widening Task 10's scope
to `/api/characters/[id]` so the Create and Link flows could persist at all.
