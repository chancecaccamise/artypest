# Map Specification

Location resolution and the geographic data model. Read alongside
`docs/PLAT-VIEW-SPEC.md`, which covers rendering.

> **Provenance.** This document did not exist when the plat view was built.
> `docs/PLAT-VIEW-SPEC.md` refers to it by section for the resolution cascade
> (section 1), split view linked selection (section 4), and the thematic modes
> (section 5), so those three had to be pinned down before anything could be
> built against them.
>
> What follows is reconstructed from the domain, from `CLAUDE.md`, and from the
> hints in the plat view specification, which names occupancy and data
> completeness as the first two thematic modes. It is a working definition, not
> the original. When the real document arrives, diff it against this one. Every
> rule below lives in exactly one file, listed per section, so correcting a rule
> is an edit rather than a rewrite. See `docs/BLOCKERS.md`.

---

## 1. Location resolution cascade

Most records in an HOA have no coordinates of their own. A person is not a
place; they are somewhere because of a lot they live in. A vendor is somewhere
because of a mailing address. An asset is somewhere because of the parcel it
sits on.

So a location is **resolved**, not stored, and the resolution always reports
where it came from. A derived location that presents itself as fact is worse
than no location, because the board will act on it.

Implemented in `src/lib/locations/resolve.ts` as a pure function. It sits in
`src/lib` rather than `src/features/map` because `src/lib/data` exposes it on the
DataProvider and must not import from `src/features`.

### Sources

| Source | Meaning |
|---|---|
| `manual` | Placed by hand on the record. Always wins. |
| `parcel` | The centroid of the parcel polygon for the record's PIN. |
| `residence` | Borrowed from a lot the person currently resides at. |
| `ownership` | Borrowed from a lot the record currently owns. |
| `geocoded` | From the geocoding service, using a mailing or situs address. |
| `related` | Borrowed from a record it is linked to, for assets and records. |
| `governed` | The centroid of every parcel an association governs. |

`manual` and `parcel` are exact. Everything else is derived, and the user
interface says so wherever a derived location is shown.

### Per-type order

One universal order would be wrong. An out-of-state holding company's mailing
address is in Atlanta, and a person's mailing address is often the lot they
already resolve to. So the order is defined per entity type, first match wins:

| Type | Order |
|---|---|
| `property` | manual, parcel, geocoded (situs address) |
| `person` | manual, residence, ownership, geocoded (mailing address) |
| `business` | manual, geocoded (mailing address), ownership |
| `association` | manual, geocoded, governed |
| `asset` | manual, related (adjacent or owned parcel), governed |
| `record` | manual, related (`data.propertyId`), related (any linked property) |
| `document` | manual, related (a record that references it, and only when that record is itself exactly placed, per the one-borrowing rule below) |

A record that matches nothing is **unplaced**. Unplaced is a normal state, not
an error, and the map surfaces it in a tray rather than hiding it.

### Rules

- Only **current** relations resolve. A lot someone sold in 2011 does not place
  them. Currency uses the same `isCurrent` test the rest of the app uses.
- Resolution is **one borrowing, then stop**. A person borrows from a lot, and
  that lot resolves from its own parcel geometry, which is not a borrowing.
  Nothing borrows from something that itself borrowed. Putting the 1994
  covenants on a lot because a violation happened to cite them is exactly the
  location nobody can explain that this rule prevents.
- A borrowed location records **which record it was borrowed from**, so the side
  panel can say "Lives at 1147 E 46th St" rather than showing a bare dot.
- Archived and soft-deleted records do not lend their location to anything.

---

## 2. Geographic data model

Parcels are geographic data the county publishes, not entity data the
association maintains, so they are stored and keyed separately and joined on the
PIN. That is the same key the parcel import already matches on.

```
src/lib/geo/fixtures/
  ardsley-parcels.json    FeatureCollection<Polygon>, `pin` per feature
  ardsley-streets.json    FeatureCollection<LineString>, `name` per feature
```

- **EPSG 4326**, longitude first, as GeoJSON requires.
- One `Feature` per parcel. The only required property is `pin`. Anything else
  about the lot lives on the entity, never duplicated into the geometry.
- Common areas (a pool lot, a retention pond) are parcels like any other, with a
  PIN and a property entity. They are not a special layer.
- Street centrelines are a permanent layer, not a workaround for having no
  basemap. SAGIS publishes them, so this is the same shape the real data has.

Geometry is never written by the application. If a parcel boundary is wrong,
that is a county correction, not an edit in this product.

---

## 3. Filters

The map and the directory ask the same questions, so they share one filter
shape: entity type, and the per-type `data` filters the directory already
defines. Filter state lives in the query string, so a filtered map is a link.

Filters apply to what is **drawn and lit**, never to what exists. A parcel
filtered out is drawn faintly rather than removed, because a hole in a plat
reads as missing data rather than as a filter.

---

## 4. Split view

Plat on the left, Connection Map on the right, one shared selection.

- Selecting a parcel on the plat re-centres the Connection Map on that lot's
  property record.
- Selecting a card in the Connection Map highlights and pans to that record's
  resolved location on the plat.
- A record that does not resolve cannot be highlighted, so selecting it puts a
  plain line in the plat panel saying it has no location yet, with the manual
  placement control right there.
- Selection is one piece of state in `MapView.tsx`. Neither view owns it, which
  is what keeps the two directions from fighting.

Below `lg` the split collapses to one view at a time with a toggle, because two
panes at 375px is two unusable panes.

---

## 5. Thematic modes

One dropdown, one legend, one colour function. Colours come from the token set,
never from a scale library.

Implemented in `src/features/map/theming.ts`.

| Mode | Buckets |
|---|---|
| `none` | A single ink fill. The default, and the one that reads as a plat. |
| `occupancy` | Owner-occupied, long-term rental, short-term rental, vacant or unknown. The same four segments and the same colours as the dashboard occupancy bar. |
| `completeness` | Complete, missing owner, missing parcel number, missing both. |
| `property_use` | By the org's property use reference list. |
| `zoning` | By the org's zoning reference list. |
| `open_items` | None, one, two or more open records against the lot. |

`occupancy` and `completeness` are the two that matter and are built first. A
mode must reuse an answer the app already computes: `occupancy` calls the same
classifier as the dashboard, so a lot cannot be owner-occupied on one screen and
a rental on another.

Every mode renders a legend with a count per bucket. A bucket with no lots in it
is still listed, at reduced emphasis, so the absence is visible.

---

## 6. Spatial queries

Turf, against the parcel geometry. Implemented in `src/features/map/spatial.ts`.

| Query | Definition |
|---|---|
| Adjacent | Parcels whose boundaries touch or overlap the subject parcel. |
| Within radius | Parcels whose centroid is within *n* feet of the subject centroid. |
| Within shape | Parcels whose centroid falls inside a drawn or selected polygon. |

**Notify adjacent owners** is the query that earns its keep. From a property
record, it produces the mailing list an architectural review notification needs:
every current owner of every adjacent lot, de-duplicated by owner, with the
mailing address the association has on file, and each owner's missing contact
details called out rather than silently dropped.

Radius is expressed in feet because that is what covenants are written in.
