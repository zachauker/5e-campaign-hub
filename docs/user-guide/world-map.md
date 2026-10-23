# World map

A real vector map of Exandria — Wildemount and Tal'Dorei — built into the app.

Open **World** in the nav. Unlike an uploaded image, this one is drawn from actual
geographic data: coastlines, rivers, terrain, roads, and place labels that stay
crisp at any zoom and re-render as you move.

Each campaign gets its own world map, created the first time you open the page, so
two campaigns can mark up the same continent differently.

---

## Seeding it

An empty map offers **Import Exandria locations**. It creates a location entry and
a pin for every place in the bundled dataset — cities, towns, points of interest,
and regions — already positioned correctly.

This is the fastest way to get from nothing to a usable campaign map, and it's
safe to run: it matches on name, so it won't duplicate places you've already
created, and the button disappears once the map has any pins on it.

Imported places are ordinary [location entries](entities.md) from that point on.
Edit them, link them, hang threads off them, write vault notes for them.

---

## Themes

Four looks, from the selector in the toolbar:

| Theme | Reads like |
| --- | --- |
| **Classic Atlas** | A modern reference map. The default. |
| **Vibrant Painted** | Saturated, illustrated — closest to a published campaign map |
| **Antique Sepia** | Aged parchment, without being kitsch about it |
| **Dark / Night** | Low-light. The one to use at a dim table. |

Your choice is remembered.

---

## Pins

Pins work exactly as they do on [uploaded maps](maps.md) — same six types, same
per-type and per-pin styling, same layer controls, same slide-over. **Add Marker**
then click; **Move Pins** to drag; **Pin styles** for appearance; **Layers** to
thin things out; **Show / Hide Labels** for when you want to see the map itself.

Two things are worth knowing here specifically:

**Zoom thresholds matter more.** A continent's worth of pins is unreadable at full
extent. Uncheck **Always visible** when placing a pin and it reveals only once
you've zoomed in past where you placed it — so the overview stays legible and the
detail is still there when you go looking.

**Sub-maps are the bridge.** A sub-map pin on a city takes you from the continent
to your own uploaded city map. That's the intended arrangement: real geography for
the world, your own images for the places the party actually walks around in.

---

## What isn't here

The dataset covers the Wildemount and Tal'Dorei overworld only. Other continents
and city-interior detail are deliberately excluded — for city interiors, upload
your own map and hang it off a sub-map pin.

The map data comes from RossThorn's open-source-exandria project. Regenerating or
extending the artifacts is a developer task; see
[`world-data/README.md`](../../world-data/README.md).
