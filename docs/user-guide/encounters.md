# Encounters

The initiative tracker — the oldest part of the app and the one that has to work
while six people are talking at you.

Open **Encounters** in the nav. Name one in the box at the top and press Enter to
drop straight into it.

---

## The list

Every encounter you've ever run, newest activity first, each showing its status —
**Ready**, **Active**, or **Done** — and the round it reached. Encounters are kept
after they end; nothing is thrown away.

Hovering a row reveals a delete button. Deleting is permanent and takes the
combatants with it, so it asks first.

---

## Running a fight

### Add combatants

**Add Combatant** (or press `A`) opens a dialog with six tabs, in roughly the order
you'll want them:

| Tab | For |
| --- | --- |
| **Monster** | Search Open5e — type `goblin`, `dragon`, whatever. Full stat block comes with it. |
| **NPC** | A name, HP, AC, and an initiative. For the guard who exists for four rounds. |
| **Upload** | A stat block from a JSON file, for homebrew or a book you've typed up. |
| **Library** | Anything you've saved before, so the recurring villain is one click. |
| **D&D Beyond** | Your players' actual sheets — see below. |
| **Characters** | Someone already in your campaign glossary, linked so the two stay connected. |

Monster results are cached locally after the first lookup, so the second time you
add a goblin it's instant and works without a connection.

### Start it

**Start** sorts by initiative and lights the first combatant. From there:

| Key | Does |
| --- | --- |
| `N` or `→` | Next turn |
| `P` or `←` | Previous turn |
| `A` | Add a combatant |
| `S` | Open the active combatant's stat block |
| `⌘S` | Save now |

The keys are ignored while you're typing in a field, so editing a name never
advances the turn.

The round counter and the active combatant sit together in a readout at the top
left. The active card scrolls itself into view as the turn moves, and the whole
top nav collapses to a hairline while combat is live — the fight gets the screen.

---

## Damage and healing

Each combatant has an HP bar that changes colour as it drops, and a floating
number that rises off it when HP changes, so you get confirmation without looking
away.

The controls have three modes:

- **Damage** — subtracts what you type
- **Heal** — adds it
- **Set** — makes it exactly that

Type a number and press Enter. `Esc` clears the box.

Temporary HP is tracked separately and shown as `+N` beside the bar. It's spent
before real HP, the way the rules say.

---

## Conditions

Click **Conditions** on a card for the full set: all fifteen official conditions,
plus four states the table tracks anyway — **concentration**, **dodging**,
**raging**, and **flying**.

Each one carries its rules text in a tooltip, so you can check what *restrained*
actually does without leaving the fight.

Active conditions show on the card as coloured chips with icons — never colour
alone, so they still read in dim light or if you don't see red and green the usual
way. Concentration additionally gets a `· Conc` flag next to the name, since it's
the one you'll be asked about after every hit.

---

## Stat blocks

`S`, or clicking a combatant, opens the stat block panel on the right: abilities,
saves, skills, resistances, actions, and traits. `Esc` closes it.

For a PC pulled from D&D Beyond it's their real sheet — AC, saves, passive
scores, spell save DC — not an approximation.

---

## D&D Beyond characters

Add each player's character URL once, in **Settings → D&D Beyond Characters**:

1. Open the character on D&D Beyond.
2. Click **Share** and enable sharing if it asks.
3. Copy the URL from the address bar.
4. Paste it into Settings and press **Add**.

The app fetches the character immediately and shows you what it found — name,
level, race, HP, AC — so you know the URL works before a session rather than
during one. Characters don't need to be public, only shared.

After that they appear under the **D&D Beyond** tab whenever you add combatants,
and the tracker can re-pull them mid-encounter with **Refresh** in the stat-block
panel. A card whose sheet couldn't be re-fetched is marked **Stale data** rather
than quietly showing you last week's HP.

---

## Saving

The encounter saves itself about two seconds after anything changes. The **Saved**
indicator in the header tells you where things stand, and `⌘S` forces it.

If a save fails you get a red banner that **does not go away on its own**, with a
retry button. Every other message in the app fades; this one doesn't, because a
lost save is the one failure you can't afford to miss while the table is moving.

Rapid edits are safe — a new save cancels the one in flight, so the last thing you
typed is what gets written, never an older value arriving late.

---

## Removing someone

The trash icon on a card removes them, and a toast appears at the bottom with
**Undo** for five seconds. Undo restores them at their exact HP, conditions, and
initiative.

---

## Ending

**End encounter** (the square button) marks it done and stops the turn cycle. The
encounter and everything in it stays in the list.

**Reset** puts the round counter back to one without clearing the combatants —
useful when you started tracking a round early, less useful mid-fight.

---

## Working alongside Run mode

If an encounter is active, [Run mode](run-mode.md) shows this same tracker in its
left pane, unchanged, with the lookup panel beside it. You don't have to choose
between running combat and being able to answer "wait, who is this guy" — that's
the whole point of the arrangement.
