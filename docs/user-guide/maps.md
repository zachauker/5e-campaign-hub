# Maps

Your own maps — a city, a dungeon floor, a continent someone drew for you — with
pins that link to the things in your campaign.

For the built-in vector map of Exandria, see [World map](world-map.md). The two
share their marker system, so everything below about pins applies there too.

---

## Uploading a map

**Maps → Upload**, then pick one of two kinds. This choice matters and can't be
changed later:

**Standard** — city layouts, dungeons, battle maps, anything you'd view roughly
whole. Uploads instantly and pans and zooms in the browser.

**Large-scale interactive** — continent maps and anything you want to zoom deep
into. The image gets cut into tiles at several zoom levels, so it stays sharp all
the way down instead of turning to mush. **Upload takes a minute or so** and
accepts PNG, JPEG, or WebP.

Rule of thumb: if you'd ever want to zoom past "the whole thing on screen", tile
it.

You can rename or delete a map from the pencil and trash icons next to its name in
the viewer's breadcrumb.

---

## Pins

**Add Marker**, then click the spot. A dialog asks what kind of pin it is:

| Type | Links to | Use for |
| --- | --- | --- |
| **Location** | A location entry | Cities, towns, POIs, regions |
| **Character** | A character entry | Where someone is, or where they were last seen |
| **Faction** | A faction entry | Territory, headquarters, presence |
| **Event** | A session note | Where something happened — see below |
| **Note** | Nothing; free text | A thought that isn't an entity yet |
| **Sub-map** | Another map | Nesting — see below |

Pins linked to an entry pull their name from it, so renaming the entry renames the
pin. A title override is available if you want the map to say something else.

Clicking a pin opens a **slide-over** on the right with its details and a link
through to the full entry. Clicking the map background closes it.

### Moving pins

**Move Pins** turns on dragging. Drag, drop, and a toast offers **Undo** if the
drop wasn't where you meant. Turn it off when you're done — it's a mode, so it
stays on until you say otherwise, and that's deliberate: repositioning ten pins
shouldn't take twenty clicks.

### Sub-maps

A **sub-map** pin nests one map inside another: click the pin on the continent,
land on the city. You can point it at an existing map or upload a new one right
from the dialog.

Nesting has no depth limit, and the breadcrumb at the top of the viewer always
shows where you are and walks you back up.

---

## Styling pins

**Pin styles** opens the appearance panel. There are two levels, and the
distinction is the useful part:

**Per type** — set once, applies to every pin of that kind. "All faction pins are
shields, in faction red, one size up." This is where most of your styling should
live.

**Per pin** — override a single pin. The capital gets the crown; everything else
keeps the default.

Either level can set:

- **Size** — four steps, small through extra-large
- **Shape** — teardrop, circle, square, or diamond
- **Icon** — a curated set of about thirty map and fantasy icons: castles,
  mountains, forests, skulls, crowns, ships, anchors, gems, temples, and so on
- **Colour**
- **Label size** — small, medium, large, or hidden for this pin alone

Anything you don't set falls through to the type default, and anything the type
doesn't set falls through to the built-in look. Clearing an override puts a pin
back on the default rather than freezing its current appearance.

---

## Controlling what's visible

A busy map is worse than a sparse one. Three controls thin it out:

**Layers** groups every pin on the map by what it is — locations split by city,
town, POI, and region; events split by their note type; then characters,
factions, sub-maps, and notes — each with a count and a toggle. Only groups that
actually have pins appear.

Hidden layers are remembered per map, so a map you set up for one purpose opens
that way next time.

**Show / Hide Labels** turns every pin's name on or off at once, for when you want
to look at the map itself.

**Zoom thresholds** — on tiled and world maps, a pin's dialog has an **Always
visible** checkbox. Uncheck it and the pin appears only once you've zoomed to at
least the level you were at when you placed it (adjustable in the box beside it).
That's how a continent view stays readable while every hamlet is still there when
you go looking.

---

## Session notes on the map

**Event** pins connect [session notes](sessions.md) to the places they happened.
Pin the ambush where the ambush was, and the map becomes a record of the campaign
rather than a picture of the world.

Two things make this practical:

**The date filter.** Event pins carry their note's date, and the filter at the top
of the viewer shows one session at a time — or all of them. It opens on the next
upcoming session, so a prep session starts on what's ahead rather than everything
that ever happened. Change it and your choice sticks.

**The unpinned tray.** A collapsible strip at the bottom lists session notes for
the selected date that aren't pinned to any map yet. Click one, click the map,
done. It's the fastest way to place a session's worth of events, and it doubles as
a checklist of what you haven't placed.

Every pin also shows up on its note's own page under **Pinned on**, so the link
reads from both directions.

---

## Where pins show up elsewhere

- An entry's detail page lists every map it's pinned on, under **On the map**.
- The [assistant](assistant.md) can read a map's markers, and can propose new ones
  for you to confirm.
