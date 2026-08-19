# Chronicle

Where the campaign is *in time*, and what's still hanging: the in-world date, your
open threads, the clocks counting down, and a record of what happened when.

Open **Chronicle** in the nav.

---

## The in-world date

Everything here is measured in in-world days, so the first thing Chronicle asks
for is a date. Give it a day, a month from the Exandrian calendar, a year, and an
epoch label (`PD` for the standard reckoning).

Once set, the current date is the page's headline, with a count of open threads and
running clocks underneath. **Correct date** fixes a mistake without disturbing
anything that already happened.

### Advancing time

From the **Timeline** tab, or from the command palette's **Advance in-world date**.

Say how many days pass and the dialog shows what that does *before* it does it:
every clock whose cadence comes due, how many segments each would gain, and which
ones would fill. Everything due is checked by default — uncheck what you don't
want.

This is the moment a month of downtime turns into three factions having made
progress, which is the whole reason clocks exist.

---

## Threads

An open question the campaign hasn't answered. "Who poisoned the archivist." "Will
the Guild honour the deal." Not a task list — the things that would be
unsatisfying to leave unresolved.

**New thread** asks for:

- **Title** — the question
- **Stakes** — *what goes wrong if it stays open*. Worth filling in. It's what
  Run mode shows you at the table, and it's what makes a six-week-old thread
  legible again.
- **Links** to the characters, locations, items, factions, and sessions involved,
  each with a role:
  - **subject** — the thread is about them
  - **stakeholder** — they care how it lands
  - **obstacle** — they are in the way

### Status

**Open** · **Dormant** · **Resolved** · **Abandoned**

All four are set by hand. Nothing goes dormant on its own — a thread you haven't
touched in two months is still open, and the app won't pretend otherwise on your
behalf. Resolved and abandoned threads are hidden by default; a toggle brings them
back.

### Staleness

Each thread shows how long it's been since anything touched it, and says what that
means rather than making you do the arithmetic: **recently touched**, **going
cold**, **long neglected**. The last one is flagged in red with a warning icon.

This is the list's real job. Not tracking what you're working on — surfacing what
you've quietly stopped working on.

### Where threads show up

- On every linked entity's [detail page](entities.md)
- In [Run mode](run-mode.md), under the entity you just looked up, plus everyone
  else tangled in the same thread
- In **Build briefings for next session**, which reads exactly this list to decide
  who's likely to come up

---

## Clocks

Borrowed from Blades in the Dark: a ring of segments that fills as something
progresses. When it fills, the thing happens.

**New clock** takes:

- **Name** — what's coming
- **Segments** — how far away it is. Four is soon, eight is a campaign arc.
- **Ticks every … days** — the cadence. Leave it blank for manual-only.
- **Payoff** — *what happens when it fills*. Write this down. A filled clock with
  no payoff is a puzzle you set for yourself.
- **Owner** — optionally a faction, location, or thread

### Cadence

A clock with a cadence advances on its own when in-world time passes — but only
through the advance dialog, and only with your approval. It never ticks behind
your back, and only whole cadence periods count, so a 7-day clock advanced by 10
days ticks once and remembers the remaining 3.

Manual clocks are just clocks you tick yourself, with the arrows on the dial.

### Status

**Running**, **paused**, or **complete**. Pause a clock the party has interrupted;
it stops accruing until you resume it. Filling marks it complete and records it on
the timeline.

The dial colours as it fills — but the number is always written on it, so it reads
whether or not you see the colour.

---

## The timeline

Under the clocks: a dated record of what changed, in order. Threads opened and
resolved, clocks ticked and completed, time advanced, sessions played, and notes
you add yourself.

Each entry is labelled with where it came from — set by hand, applied from a
proposal, or ticked automatically by cadence — so you can tell what you decided
from what the app inferred.

Deleting a thread or clock doesn't erase its history. The timeline is a record; it
doesn't rewrite itself.

---

## Session review

The engine that keeps all of this current without you maintaining it by hand.

Open a [session note](sessions.md) and press **Review session**. An agent reads what
you actually wrote and proposes updates: threads to open or resolve, clocks to
tick, time to advance. Each proposal quotes the line from your notes that prompted
it — **verbatim**, and checked against the notes, so a proposal built on something
the model invented is thrown out before it reaches you.

Approve individually. A date-advance proposal opens the advance dialog so you still
choose which clocks tick. Nothing is applied until you approve it, and approving is
idempotent — a double-click won't open the same thread twice.

The button shows a dot when a note has changed since its last review, so you can
tell "never reviewed" apart from "reviewed, then rewritten".

This uses your Anthropic API key: one model run per review.

---

## Getting the most out of it

**Write stakes.** The title says what the thread is; the stakes say why you care.
Six weeks later only one of those is still obvious.

**Give every clock a payoff.** Filling a clock should tell you what to do, not
prompt an archaeology session.

**Review each session while it's fresh.** The proposals are only as good as the
notes, and it's cheaper to correct a thread the week it opened.

**Let the neglected list nag you.** A thread going red isn't a failure — it's the
app telling you something you cared about has been off-screen for a month, which
is exactly the thing that's hard to notice from the inside.
