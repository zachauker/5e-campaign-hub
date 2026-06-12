---
target: app/encounters/[id]/page.tsx
total_score: 26
p0_count: 0
p1_count: 3
p2_count: 2
timestamp: 2026-06-12T18-23-28Z
slug: app-encounters-id-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Save, sync, HP feedback all solid; DDB sync failure is silent |
| 2 | Match System / Real World | 3 | Correct D&D terminology throughout; "active" vs "turn" distinction clear |
| 3 | User Control and Freedom | 3 | Drag reorder, inline edit, reset round — no undo for remove |
| 4 | Consistency and Standards | 3 | Init is single-click to edit; name is double-click — one inconsistency |
| 5 | Error Prevention | 2 | DDB sync failures silent; no guard on remove during active combat |
| 6 | Recognition Rather Than Recall | 3 | KB hints visible, condition emoji recognizable, HP bar color semantic |
| 7 | Flexibility and Efficiency of Use | 3 | N/P/A/⌘S shortcuts; no shortcut for stat block or active combatant focus |
| 8 | Aesthetic and Minimalist Design | 3 | Two nav bars before the actual combat surface; minor chrome overhead |
| 9 | Error Recovery | 2 | Save failures invisible; DDB staleness undetectable; no error message for fetch |
| 10 | Help and Documentation | 1 | KB hints only; no contextual help; conditions unexplained for new DMs |
| **Total** | | **26/40** | **Acceptable — meaningful improvements needed** |

---

## Anti-Patterns Verdict

**LLM assessment**: Not AI-generated. The semantic color system (gold for initiative/active, traffic-light HP, crimson primary) is intentional and coherent — not a reflex. The dark theme is earned by the use case (gaming table, dim ambient light) not by aesthetic fashion. The ranked initiative list correctly refuses to be a card grid. The "war room readout" treatment of the round number is specific and non-generic. No gradient text, no side-stripe borders, no eyebrow labels, no hero-metric SaaS clichés detected.

The closest slop risk: the two stacked navigation bars at the top of the page (app nav + encounter controls) create a "generic dark app" header sandwich. The actual combat content starts below ~90px of chrome. On a 13" laptop in landscape this is measurable dead weight.

**Deterministic scan**: The automated detector returned zero findings across `components/tracker/` — no gradient text, no tracked uppercase eyebrows, no side-stripe borders, no numbered section markers. Clean.

**Visual overlays**: Browser injection unavailable (Chrome extension not responding). No overlay produced; report based on source review.

---

## Overall Impression

The fundamentals are right: dark, atmospheric, semantic color, correct domain language. This feels like a purpose-built DM tool, not a repurposed generic app. The biggest opportunity is not aesthetic — it's the two invisible failure modes that could break trust in a live session: a silent DDB sync error leaving HP data stale, and a save failure that looks like a save success. A DM running a session with 6 players cannot afford to discover either of these during play.

---

## What's Working

**1. The active combatant treatment.** Gold background wash + layered glow + pulsing dot + gold name is the right level of drama. It reads at a glance from across a table without being garish. The layered shadow (tight ring + inner glow + diffuse bloom) is doing real visual work.

**2. The "war-room readout" in the controls bar.** The round number at `text-2xl` in gold, with the active combatant name adjacent in the same pill, is the correct hierarchy: the DM's most-needed information is the most prominent element on screen. No competition.

**3. Progressive disclosure via card expansion.** Keeping HP controls, condition picker, and actions collapsed by default — revealing them only on click — is exactly right for this density level. The compact view survives 10+ combatants on screen without scroll.

---

## Priority Issues

### [P1] Stacked navigation doubles the chrome overhead

**What**: The page has a nav bar (back arrow + "Encounters" breadcrumb) *and* the EncounterControls bar immediately below it. Together they consume ~80-90px before any combat content appears. On a 768px-tall laptop screen this is ~12% of vertical space for navigation that's almost never used during combat.

**Why it matters**: The DM's eyes should be on the initiative list and the active combatant. Every pixel of nav chrome they have to mentally discard is visual noise. The back button is relevant before and after combat, not during.

**Fix**: Collapse the back-navigation into the EncounterControls bar. A ghost `ArrowLeft` icon in the controls row (far left) before the encounter name achieves the same affordance with zero vertical cost. The "Encounters" breadcrumb text can be a tooltip or simply dropped — the back arrow is self-explanatory.

**Suggested command**: `/impeccable layout`

---

### [P1] DDB sync failure is completely silent

**What**: When `useDDBSync` fails to fetch a character (network error, DDB rate limit, character endpoint returning 500), the catch block calls nothing. The combatant card continues showing the last-known HP, spell slots, and conditions as if they're current. There is no visual indicator that the displayed data may be hours old.

**Why it matters**: The DM is making real-time decisions based on this data. "Aria has 3 spell slots remaining" — but if that data is from 2 hours ago, the DM could make wrong calls that affect the session narrative.

**Fix**: Track the last-sync status per-combatant (`lastSyncSuccess`, `syncError`) in the store. When sync fails, show a small amber `⚠` badge on the PC's avatar or HP bar with a "stale data" tooltip. The StatBlockPanel's sync indicator already shows `lastSyncedAt` — expand this to surface failure state there too.

**Suggested command**: `/impeccable harden`

---

### [P1] Save failures are silent

**What**: In `page.tsx`, the `save()` function calls `PATCH` but has no error handling. If the request fails (network timeout, server error), `setSaving(false)` is called in `finally`, `markClean()` is NOT called (because it's in the try block), so `isDirty` stays true. The Save button reverts from "Saving…" back to "Save" — which looks identical to a normal pre-save state. The user has no indication that their encounter data was not persisted.

**Why it matters**: If the DM's session crashes after a save failure they didn't know about, they lose all encounter state for that session: HP, conditions, initiative, added combatants. During a live session this is catastrophic.

**Fix**: Add a `.catch()` or `try/catch` block that sets a `saveError` state. Show a toast or inline error: "Save failed — check your connection" with a retry button. Also consider wrapping `markClean()` so it only runs on confirmed success.

**Suggested command**: `/impeccable harden`

---

### [P2] Removing a combatant is irreversible and unguarded

**What**: The trash button in the expanded card calls `removeCombatant(c.id)` immediately — no confirmation, no undo, no recovery. During a live session, a misclick (common under stress, on a trackpad, with players talking) permanently deletes the combatant with all its HP, conditions, initiative, and notes.

**Why it matters**: Rebuilding a combatant mid-combat requires interrupting the session. For the active combatant specifically, removing it will trigger turn-advancement logic in an unpredictable state.

**Fix**: Either (a) add an undo toast (`"Goblin Chief removed — Undo"`) with a 5-second window that re-inserts the combatant at the same position, or (b) for the active combatant specifically, show a one-click confirmation directly in the card ("Really remove active combatant?"). Option (a) matches the PRODUCT.md principle "The table doesn't wait" better than a blocking dialog.

**Suggested command**: `/impeccable harden`

---

### [P2] No keyboard shortcut to focus the active combatant's stat block

**What**: To view the current combatant's stat block mid-combat, the DM must: (1) click the active combatant card to expand it, (2) click "Stat Block" or "Sheet". Two clicks, two visual context switches. For 8+ combatant encounters this is slow.

**Why it matters**: The stat block is the DM's reference during the active combatant's turn. If it takes 2 clicks to surface it and 2 clicks to dismiss it, DMs will stop using it and rely on paper notes — defeating a core feature.

**Fix**: Add a keyboard shortcut (e.g., `S` or `F`) that opens the stat block for the currently active combatant. This is consistent with the existing `N/P/A/⌘S` system and fits the "power user" mode the DM is operating in.

**Suggested command**: `/impeccable harden`

---

## Persona Red Flags

### Alex (Power User / the DM)

Alex is a DM with 10 years of D&D experience. They run the tool from a laptop while simultaneously managing 6 players, rolling dice, and improvising. They expect the tool to get out of their way.

**Red flags**:
- No keyboard shortcut to surface the active combatant's stat block — forces a context-breaking 2-click detour
- Save failure looks identical to pre-save state — Alex will not realize the session is unsaved
- Drag reorder works but there's no keyboard alternative for reordering initiative (e.g., after a Readied Action changes order)
- Expanding a card closes the previous one — discovery path for HP editing requires a click-into-card that Alex may not find immediately

### Riley (Stress Tester)

Riley will probe the edges of this tool with 15 combatants, rage-clicking the trash button, and refreshing the page at inopportune moments.

**Red flags**:
- Removing the active combatant during combat is untested — `nextTurn()` with a missing `currentCombatantId` could enter a bad state
- What happens at 0 combatants when encounter is "active"? The start button is disabled for 0 combatants but the `endEncounter` path with an active encounter and 0 combatants is unhandled
- Auto-save fires every 2 seconds after any `isDirty` — with rapid HP changes (healing, damage, temp HP) this fires repeatedly; the PATCH request could overlap with itself
- If the page is navigated away from during a save, the fetch is abandoned — no cleanup

### The Mid-Session DM (project-specific)

A DM 90 minutes into a 4-hour session. Players are engaged, dice are rolling. They need to check an NPC's stat block while the active player describes their action, update HP from an attack roll, advance the turn, and repeat — all without losing the room's momentum.

**Red flags**:
- The PC sheet panel opens/closes but there's no keyboard shortcut to close it — requires a mouse click to dismiss the sidebar, which can interrupt flow
- With 8+ combatants, the active combatant can scroll off-screen if the DM was reviewing a different card — no "scroll to active" behavior
- The DDB sync refresh button in the stat block header requires a deliberate click; an automatic refresh on turn-advance for the active combatant's PC sheet would be more useful

---

## Minor Observations

- The `c.color` field still exists in combatant data (visible in the type) even though the border-left visual use was removed. If it's no longer visual, it can be cleaned up from the type and schema to avoid confusion.
- The HP compact widget shows `current/max` as a fraction inside a colored bar — but when HP is `0`, the bar is empty and the text reads `0/45` on a black background with low contrast. Verify this reads at 4.5:1.
- The keyboard hint text (`text-[9px] opacity-40`) may be below accessible contrast at that size and opacity level.
- The `ScrollArea` in InitiativeTracker uses a Radix component — verify that keyboard scroll (arrow keys, Page Down) works correctly while focus is on a combatant card inside it.
- The `combatant-active` scroll behavior: when the active combatant changes (next turn), the list doesn't auto-scroll to keep the active card in view. If it's 8 cards down and the DM was reviewing card #1, they don't see the gold highlight until they manually scroll.

---

## Questions to Consider

- What if the stat block keyboard shortcut was `Space` — the most natural "reference the current thing" key in a list context?
- Does the DM ever need to "freeze" the encounter (pause, mid-session break) vs fully End it? The current model has Start/End with no pause state.
- What if the active combatant card auto-scrolled into view on turn advance? Would this feel helpful or disorienting with drag handles nearby?
