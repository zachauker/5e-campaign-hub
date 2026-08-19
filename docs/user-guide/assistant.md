# Campaign assistant

A chat panel that can actually read your campaign — not a general-purpose chatbot
that happens to know D&D, but one with tools pointed at your own characters,
locations, threads, clocks, maps, and reference library.

**Requires an Anthropic API key**, added in **Settings → Assistant**. Every
question costs a model call against your own key.

---

## Opening it

Press `⌘K` (`Ctrl+K`), type your question, and take the last row —
**Ask the assistant: "…"** — or press `⌘↵`. The panel opens on the right with your
question already sent.

That's currently the only way in, which makes the command palette a single box
that either jumps you somewhere or answers you, depending on what you type.

The row is greyed out until a key is configured.

---

## What it can see

| It can read | Meaning |
| --- | --- |
| **Your entities** | Characters, locations, items, factions — searched by name, listed, or read in full |
| **Relationships** | Who is linked to what |
| **Threads and clocks** | What's open and what's counting down |
| **Map context** | A map and the markers on it |
| **Monsters** | The Open5e stat-block catalogue |
| **Your reference library** | The SRD and any PDFs you've added |

It resolves names before answering, so "what do we know about the Bright Queen"
finds your Bright Queen rather than reciting published lore at you.

---

## What it won't do

**It never writes anything by itself.** When a question implies an action — build
this encounter, create this NPC, put a pin here, run a Notion sync — it produces a
**proposal**: a card in the panel describing exactly what would happen, with
**Confirm** and **Dismiss**.

Nothing happens until you press Confirm. The assistant is told to say what it
proposed and that it needs your confirmation, and never to claim it changed
anything.

The proposals it can make:

- **Build an encounter** — named, with combatants, ready to open in the tracker
- **Create or update an entity**
- **Place a marker** on a map
- **Run a Notion sync**

There's a second, quieter limit worth knowing: proposals can only touch fields the
hub owns. It can't propose overwriting a location's type or an item's description
when those come from Notion, because the next sync would revert it anyway and
you'd be left wondering why your change didn't stick.

---

## Rules and lore questions

For anything about how the game works, or about published setting material, the
assistant searches your [reference library](reference-library.md) and **cites the
passages it used** — the sources appear as chips above the answer.

If the library has nothing relevant, it says so instead of answering from memory.
That's the deliberate trade: an assistant that admits it has no source beats one
that produces a confident, plausible, wrong rule at the table.

Which means the assistant is only as good as what you've indexed. SRD 5.1 is
bundled; if you want it to answer from a specific setting book you own, add it in
[Settings → Reference Library](reference-library.md).

---

## Getting good answers

**Ask about your campaign, not about D&D generally.** "Who has a reason to want
Ophelia dead" uses the tools. "Write me a tavern" doesn't, and you have better
tools for that.

**Use it for the questions that span sections.** Threads plus factions plus who
was at that location six sessions ago — the joins that are tedious to do by
clicking.

**Name the thing you mean.** It searches before answering, so a name or a
distinctive phrase gets it to the right entry faster than a description.

**Read the proposal before confirming.** It says exactly what it will do. That's
the point of it being a card and not a side effect.
