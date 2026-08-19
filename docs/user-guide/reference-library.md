# Reference library

The rulebooks and lore the [assistant](assistant.md) is allowed to cite. Add a
source, and rules questions get answered from its actual text with a reference back
to where the answer came from.

**Settings → Reference Library.**

Everything here runs on your machine. Documents are chunked and embedded locally
with a bundled model and searched locally — nothing is uploaded, and the library
works without a connection. Only the assistant's own reasoning uses the API.

---

## Adding sources

### The SRD

**Import SRD** indexes the bundled SRD 5.1 — the freely licensed core of 5e. Start
here; it covers conditions, spells, combat, and the rules you'll actually be
interrupted about.

### Your own documents

Anything else goes through the inbox:

1. Drop the file into `reference-inbox/` on the server (the `./data` volume, if
   you're running the Docker image).
2. It appears under **Inbox** in the panel, with its size.
3. Press **Ingest**.

PDFs and plain text both work. PDFs are read page by page, and the page number
travels with each chunk, so a citation points at a page rather than at the book.

Ingestion shows a progress bar. Large books take a few minutes — do it before a
session, not during one.

The inbox is deliberately a real directory rather than an upload box: a
three-hundred-megabyte rulebook is better copied over once than pushed through a
browser.

---

## Managing what's indexed

Each source lists its type and how many chunks it produced, with three controls:

**Enabled / Disabled** — take a source out of search without deleting it. Useful
when a homebrew document and an official one disagree and you want to see which
answer you get from which.

**Delete** — remove it and its chunks entirely.

**The note** — a line of context telling the assistant what this source *is* and
how much to trust it. This is the most underused control on the page and it's
doing real work:

> *official Wildemount setting book; authoritative for setting/lore*

> *my homebrew rules; overrides the SRD where they conflict*

> *third-party bestiary; flavour only, not official*

Without notes, the assistant sees a pile of equally-weighted text. With them, it
knows which source wins.

---

## How search works

Searching is semantic, not keyword: asking about "being unable to see" finds the
*blinded* condition without you having used that word.

Results come back as passages with a source reference, and the assistant is
instructed to cite what it used and to **say it has no source rather than
answering from memory**. The chips above an answer are the passages behind it.

If answers seem thin, the library is usually the reason — either the relevant book
isn't indexed, or it's indexed and disabled.

---

## What it's for, and what it isn't

**Good:** rules adjudication mid-session, spell and condition details, monster
abilities, published setting lore, your own house rules.

**Not this:** your campaign's own notes. Those belong in
[Notion](notion-sync.md) and reach the assistant through entities and session
notes, which it reads directly. The reference library is for published material
that doesn't change.

---

## Setup note for self-hosted installs

The embedding model lives on the `./data` volume rather than inside the image, so
it survives updates and doesn't bloat every deploy. If the panel reports it can't
embed, the model directory is the thing to check —
[`reference-data/DEPLOY.md`](../../reference-data/DEPLOY.md) covers fetching it.
