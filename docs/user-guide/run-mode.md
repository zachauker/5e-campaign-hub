# Run mode

A DM's guide to running a session with the app open.

Everything else in this hub is built for prep — reading, writing, linking. Run
mode is the opposite: it assumes players are waiting, one of your hands is busy,
and you have about three seconds. It answers "who is this and what do they want"
from your own machine, and it lets you flag a moment without typing.

Open it from **Run** in the nav, last on the right.

---

## Before your first session

**Settings → Search index → Rebuild search index.** Do this once.

The at-table index starts empty, so until you build it, searching finds almost
nothing — which looks exactly like the feature being broken rather than a step
you haven't taken yet. It takes seconds and reports how many records it indexed.

After that it maintains itself as you add and edit things. You only need to
rebuild again if you restore a backup or import a lot of data outside the app.

---

## The keyboard

Run mode is built around not needing the mouse.

| Key | Does |
| --- | --- |
| any letter | jumps to the search box and starts typing |
| `↑` `↓` | move through results |
| `Enter` | pin the selected card so it stays on screen |
| `→` | follow a related entity |
| `←` | go back the way you came |
| `Esc` | clear the search and let go of the box |
| `Space` | flag this moment |
| `1`–`5` | label the moment you just flagged |

**One thing worth knowing:** `Space` flags a moment only when you are *not* in
the search box — otherwise it types a space, which is what you'd want. If you've
been searching and want to flag something, press `Esc` first. `Esc` clears the
box and hands the keyboard back.

The arrow keys and `Enter` work while the search box has focus, or after you've
clicked a result. `Space` and the number keys work everywhere else.

---

## What's on screen

**Left — the live scene.** If an encounter is running, this is the initiative
tracker you already use, unchanged. If one isn't, you get the scene board:

- **In the room** — whatever you've pinned
- **Open threads** — unresolved questions, with their stakes
- **Clocks** — with their fill, and a marker when one is paused or complete

It refreshes on its own every fifteen seconds, so ticking a clock in another tab
shows up here without a reload.

**Right — the answer panel.** Type, pick a result, read the card.

**Bottom — the strip.** Elapsed time, how many moments you've flagged, the last
few of them, and **End run**.

---

## Briefing cards

A briefing is five short things about one entity, written to be read aloud-adjacent
rather than studied:

| Field | Is |
| --- | --- |
| **Is** | who or what they are, in a line |
| **Wants** | what they're after right now |
| **Party knows** | what the party has actually learned — as distinct from what you know |
| **Voice** | how to sound like them again three sessions later |
| **Secret** | something true they haven't earned yet |

**The secret stays hidden until you click it.** It isn't just visually quiet —
it isn't on the screen at all until you ask for it, so a player reading over your
shoulder gets nothing.

**Tangled up with** sits under the card: everyone sharing an open thread with
this entity. `→` walks to them, `←` comes back.

### Two badges

- **Behind its notes** — the entity has changed since the briefing was written.
  The card still works; it's just describing a slightly older version. Refresh it
  with either build in **Settings → Briefing builds** — both rebuild anything
  that has fallen behind, and skip everything that hasn't.
- **Built without the note body** — the briefing was written without the vault
  note, either because the note couldn't be read or it was empty. It's thinner
  than it should be.

### When there's no briefing yet

You get the entity's description and its open threads instead, plus a **Build
briefing** button. It never shows you an empty card — a worse answer beats no
answer with six people waiting.

---

## Flagging moments

Press `Space`. That's the whole interaction.

You get four seconds to label it with a number key, and the labels appear in the
strip so you don't have to remember which is which:

`1` npc · `2` promise · `3` loot · `4` lore · `5` todo

Ignoring the window is fine — an unlabelled flag is a complete, valid flag. The
moment labelling becomes something you *have* to do, you'll stop flagging.

Each mark records how far into the session it happened and what was on your
screen at the time. That context is what makes it mean something later; a bare
timestamp doesn't.

### If something goes wrong

- A **banner across the top** means the run never started and nothing is being
  saved. It has a retry button. This is the one thing that would otherwise be
  invisible, so it's deliberately impossible to miss.
- **"N unsaved"** in the strip means marks have failed to save and are retrying.
  A mark waiting out its four-second labelling window is *not* counted here —
  the warning stays quiet during normal use so it means something when it isn't.

Marks survive a browser crash. They're written to your machine the instant you
press the key, and picked up again next time you open Run mode.

---

## Building briefings ahead of time

Run mode builds a briefing the first time you look an entity up there. That
works, but it costs a pause you may not want mid-scene.

**Settings → Briefing builds** does it in advance:

- **Build briefings for next session** — everything tangled in an open thread
- **Build all briefings** — the whole campaign

Both skip anything already current, so re-running is cheap and an interrupted
build just picks up where it stopped. Each entity costs one Anthropic API call,
so a campaign-wide build is not free.

Opening any character, location, item or faction page also builds that one
briefing quietly in the background if it doesn't have one.

### Correcting a briefing

Not yet, from the app. The card is read-only wherever it appears, and there is
currently no screen for editing a field by hand — see **Known limits** below.

What you *can* do is change the source and rebuild: the briefing is written from
the entity's description, its vault note, and its open threads, so fixing
those and re-running a build in **Settings → Briefing builds** is the way to
correct a card that has someone wrong.

---

## Ending a session

**End run** in the strip. It saves anything still pending before closing, so
don't worry about flags made in the last few seconds.

If you forget, nothing breaks — starting your next session closes the old run
automatically, so tonight's flags never land on last week's timeline.

---

## Known limits

**Briefings can't be hand-edited yet.** The storage underneath distinguishes a
field you wrote from a generated one, and protects yours from being overwritten
by a rebuild — but nothing in the app exposes that yet. It matters most for
**Voice**: until there's a screen for it, a rebuild rewrites how someone sounds.

**Your flags aren't readable anywhere yet.** Marks are captured, labelled, and
stored safely — but there is currently no screen that shows them next to a
session's notes, and they aren't yet fed into the post-session review. Getting
them back out is the next piece of work. Until then they're accumulating
correctly and waiting.

**Search matches names and text, not meaning.** Typing `aljinn` finds `Al'Jinn`
and `the mask guy` finds whoever you've nicknamed that — but it won't find
someone from a description you never wrote down. Aliases are worth adding for
anyone the party calls something other than their name.

**One run at a time per campaign.** Opening Run mode starts a session; opening
it again ends the previous one. Two campaigns can each have their own run going
without interfering.
