# Progress

Running status log. Newest last.

## 2026-07-31: project scaffold and layout

**Did.**

- Scaffolded Vite + React 18 + TypeScript strict, with the `@/*` path alias
- Configured Tailwind v4 with the shadcn/ui token set, light and dark, plus
  `components.json` so `shadcn add` works
- Configured ESLint 9 (typescript-eslint, type-checked rules, `no-explicit-any`
  and `ban-ts-comment` as errors), Prettier, and Vitest with Testing Library
- Added the `pnpm verify` script: typecheck, lint, test, build
- Created the full `src/` layout from `CLAUDE.md`
- Ran `supabase init`, leaving `supabase/config.toml` and `supabase/migrations/`
  in place but dormant
- Built a temporary in-memory data layer in `src/lib/data`: the `DataProvider`
  contract, demo fixtures for all seven entity types, and a provider that keeps
  archive and soft delete separate and writes one audit row per changed field
- Wrote `DECISIONS.md` and `BLOCKERS.md`

**Verified.** `pnpm verify` passes clean: typecheck, lint, 9 tests, production
build. Tests cover entity list filtering, search, pagination, the archive and
soft delete split, field-level audit rows, and bidirectional relation reads.

**Not done, and why.** No schema migrations, no seed data, no Zod schemas. All
three need `docs/BUILD-PLAN.md`, which is missing. See `BLOCKERS.md`.

**Next.** Supply `docs/BUILD-PLAN.md`. Then either build the app shell and
entity CRUD against the in-memory provider, or install Docker and start on the
migrations. The provider interface means those two can proceed independently.

## 2026-07-31: the user interface, built to `UI-SPEC.md`

**Did.** Everything in the UI specification, plus the Connection Map the user
asked for by screenshot.

*Design system.* The specification's token set as CSS custom properties in
`src/index.css`, mapped to utilities through Tailwind v4's `@theme`. Light and
dark, no pure black or white in either. Bricolage Grotesque, Public Sans, and
IBM Plex Mono bundled through `@fontsource`. The monospace identifier chip is a
component, `IdChip`, used in the tables, the record headers, the parcel card,
and the map. Hairline rules carry the structure; the only shadows in the app are
on the dialog and the tooltip.

*Shell.* Collapsible sidebar with the four labelled groups and a live count per
directory and community item. Header with the org name, the global search
placeholder (focusable with `/`, and it says search arrives in Phase 2 rather
than failing silently), a role switcher, and a theme toggle. Below `lg` the
sidebar becomes a sheet.

*Dashboard.* All four rows: the six-tile stat strip, Needs Attention beside
Board and Committees, Recent Activity beside Occupancy, and Quick Add beside the
Connection Map card. Every widget has a loading skeleton and an empty state.
Needs Attention reads all seven sources named in the specification.

*Directory.* One list component and one detail component drive all seven entity
types from `src/features/directory/config.tsx`. List view has the filter bar,
sortable 40px rows, zebra striping, identifier chips, and pagination at 50, and
becomes stacked cards below `sm`. Detail view has all six tabs. History is fully
working and reads as a field-level diff. Notes autosave and are never rendered
for a resident. Files and Add Connection are visibly disabled and labelled.

*Activity.* The full-page audit feed, grouped by day, filtered by entity type,
action, actor, and an inclusive date range, paginated at 100. Filter state is in
the query string, so a filtered view is a link.

*SAGIS.* `src/lib/parcels` behind a `ParcelService` interface, with
`FixtureParcelService` reading a committed 60-record sample. `SagisParcelService`
deliberately does not exist. The three genuinely functional pieces are real and
unit tested: PIN validation for both shapes, jurisdiction derived from the
leading digit, and the outbound viewer link built from the org's URL template
(rendering the PIN as plain text when no template is configured). The Parcel
Record card is on every property, with a disabled Refresh and a "Last checked:
Not connected" line.

*Parcel import.* Four working steps against the fixture. Source (paste, CSV, or
load the sample), Preview with row selection, Match with per-row overrides and
an inline old-to-new diff, and Confirm with summary counts. Owner matching
normalises `SMITH, JOHN A` onto a stored `John A. Smith`; the person or business
guess is a name heuristic the user can override per row. Every write goes
through the DataProvider inside one audited batch, and the result screen links
to exactly that batch in Activity.

*Settings.* All six tabs functional: organization (with a live preview of the
viewer link built by the same function the app uses), integrations (status only,
no dead Connect button), reference data (add, rename, reorder, deactivate),
relation types (read only), appearance, and the stubbed user list.

*Connection Map.* Built rather than stubbed, because the user supplied a
screenshot of what they wanted. Focus card at the top, direct connections
beneath on drawn edges labelled with the relation as read from the focus record,
a second ring on dashed lines, type filter chips with counts, and a search box.
Clicking a card re-centres the map and pushes history, so the back button is the
undo. See `DECISIONS.md` for why this departs from the specification's phasing.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 184 tests, and a
production build. Tests cover the PIN and owner-name pure functions, the
dashboard arithmetic, the provider contract, the import plan and its application
against a real provider, and route-level rendering of every page.

The app was also run and driven in a browser. No console errors on any route. No
horizontal overflow at 375px on the dashboard, the properties list, or the map.
Four real defects were found this way and fixed: an owner-occupied tile that
disagreed with the occupancy bar beside it, a raw `single_family` slug in the
parcel card, six fields printed twice on the property Details tab, and an audit
log that showed raw slugs and ISO timestamps to board members.

**Not done, and why.** No Supabase, no migrations, no RLS, and no Zod-backed
server validation, because the schema still needs `docs/BUILD-PLAN.md` and
Docker is not installed. Search, connection editing, and file upload are
deliberately unavailable and labelled with when they arrive. Nothing calls the
SAGIS API, by design.

**Next.** Supply `docs/BUILD-PLAN.md` and confirm the ten real relation types
and the per-type field lists, which are currently the provisional ones. Then
install Docker, write the migrations, and swap `src/lib/data/index.ts` to the
Supabase provider. Nothing else in the app names a backend.

## 2026-08-01: plat view

**Did.** All eight parts of `docs/PLAT-VIEW-SPEC.md`. Mapbox is not installed,
no tile was requested, and neither `MapboxGeocodingService.ts` nor
`SatelliteView.tsx` exists.

*A, the subdivision fixture.* `scripts/generate-subdivision-fixture.mjs` writes
40 parcels and 4 street segments to `src/lib/geo/fixtures/`, in EPSG 4326 on
real Ardsley Park coordinates. A through street with a cul-de-sac branch, facing
rows with varied frontage and depth, wedge lots around the bulb, a flag lot, a
diagonal corner, and two common areas (a pool lot and a retention pond). Laid
out in feet and converted at the end, because nobody believes a subdivision
reasoned about in decimal degrees. Keyed by PIN to the parcel fixture the import
already matches on.

*B, the location cascade.* `src/lib/locations/resolve.ts`, pure, with a
per-type order and a source on every answer. `resolveLocation`, `listLocations`,
and `setManualLocation` are on the DataProvider, and hand placement is audited
like any other field change. The source is surfaced wherever a location is
shown: the record's Details tab and the plat's side panel both say whether it is
exact or borrowed, and from what.

*C, geocoding.* `GeocodingService` with `FixtureGeocodingService` reading a
committed table of 99 addresses. Nineteen out-of-county owner addresses are
absent on purpose, so the unplaced tray and the manual placement fallback are
exercised by the demo data rather than only in theory.

*D, the plat renderer.* d3-geo projection with path strings memoised per
viewport size, d3-zoom for pan and zoom with explicit plus, minus, and
fit-to-view controls, and layered groups for parcels, streets, arcs, pins, and
labels, named to match what the Mapbox layers will be called. Lot numbers appear
above a zoom threshold and only on lots large enough to hold them; street names
follow the centreline on a `textPath`.

*E, the shell.* `MapView.tsx` owns filter state, thematic mode, arc selection,
and the single piece of selection state. Six thematic modes with a legend that
lists empty buckets. Occupancy calls the same classifier the dashboard totals,
which was extracted to `classifyOccupancy` so the two cannot disagree.

*F, arcs.* Off by default, one chip per relation type that has something to
draw, and a "only the selected record" narrowing.

*G, split view.* Plat left, Connection Map right, one selection. Selecting a lot
re-centres the graph; selecting a card lights that record's lot.

*H, spatial queries.* Turf adjacency, radius in feet, and within-shape.
"Notify adjacent owners" produces the mailing list de-duplicated by owner, with
owners who have no address flagged and adjacent lots with nobody to write to
listed rather than dropped.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 283 tests, and a
production build. 36 of those tests are new and cover the geometry itself, the
cascade, theming, arcs, the projection, and the plat routes end to end.

The app was driven in a browser at 1440px and 375px. No console errors, no
horizontal overflow. Four defects were found that way and fixed:

- Half the generated parcels were wound clockwise. d3-geo reads a clockwise
  exterior ring as the complement, so those lots drew as the entire rest of the
  world covering the plat. The data now follows RFC 7946 and the renderer
  reverses for d3. Both facts have tests.
- The cul-de-sac wedges listed their rear corners out of order, making a bowtie,
  which d3-geo clips against the sphere with the same result.
- The pool lot and the wedges overlapped the branch rows. Two lots cannot
  occupy the same ground on a plat, and there is now a test that says so.
- Resident markers sat on the lot centroid and swallowed the lot's click.

**Not done, and why.** No basemap, by design: that is the one thing the plat
cannot do and the only thing Mapbox adds. No satellite view. The plat is not a
placeholder for it, it is the second mode alongside it, and it is the one that
prints for a board packet.

**Next.** The plat is ready for the Mapbox swap whenever a token exists:
`SatelliteView.tsx` lands beside `PlatView.tsx` and a toggle goes in the
`MapView` header. Everything else in `src/features/map`, plus all of
`src/lib/locations` and `src/lib/geo`, is renderer-independent and carries over
untouched.

## 2026-08-17: SAGIS investigated, and connected

**Did.** Investigated the SAGIS API properly, which had never been done, then
corrected the parcel layer against what it actually serves and wrote the live
implementation. Full findings are in the new `docs/SAGIS-API.md`.

*The service.* SAGIS is a public ArcGIS Server 11.5 at `pub.sagis.org`. No
account, no API key, no quota, and it reflects the request origin in its CORS
headers, so the browser calls it directly with no proxy and no Edge Function.
Parcel attributes, parcel geometry, county-wide zoning, an authoritative address
locator, and historic parcels back to 1998 are all free. The blocker saying
"nothing calls SAGIS, by design" is resolved.

*Three assumptions the fixture had wrong.* Owner names are not `SURNAME, FIRST`:
that shape is 9,844 records against 115,312 without a comma, so `owner.ts` was
built for 7.9% of the county, and its "three or more words means an
organisation" rule called `BRUEN GARRETT JOHN` a business. There is a third PIN
format, 12 characters with both a space and a trailing letter, which validation
rejected and which is a real parcel at 106 San Marco Dr. And zoning is not a
field on the parcel at all, so the `R-6` values in the fixture were in a format
that appears nowhere in the real column.

*Two that went the other way.* Geometry comes back RFC 7946 compliant, checked
across 35 parcels, so the winding-order fix in `projection.ts` needed no change.
And the county's own locator removes any reason to add Mapbox geocoding:
`MapboxGeocodingService.ts` is off the roadmap, while Mapbox stays wanted for a
satellite basemap, which is a different job.

*Owner parsing rewritten.* `parseOwner` reads the real grammar: a shared surname
across two given names, two surnames interleaved with two given names, the
trailing record marker, generational suffixes wherever the county puts them,
`ET AL`, organisation and government tokens, and `Owner` together with `Owner2`.
It reports low confidence instead of guessing when a name was truncated upstream
at 40 characters or has no resolvable surname boundary, and the import's Match
step carries that per row. A confident wrong match attaches a property to the
wrong resident, which is the worst thing this application can do.

*Fixtures rebuilt from real data.* `scripts/fetch-sagis-fixture.mjs` replaces the
three synthetic generators and writes all four fixtures from the live service:
60 real parcels on E 49th St in Ardsley Park, their real polygons, real street
centrelines, and real geocoded addresses. Committed, so it stays reviewable in a
diff. `ParcelRecord` widened to what the county publishes, with the one
ambiguous `assessedValue` split into `fairMarketValue` and `totalAssessment`,
which is 40% of it under Georgia's assessment ratio, and `assessedYear` dropped
because the parcel roll has no such field.

*Live services.* `SagisParcelService` and `SagisGeocodingService` behind the
existing interfaces, so no call site changed. Zoning by spatial join, one request
per batch rather than per parcel. `listAll` refuses and says why: 125,326 parcels
behind a page limit is not an operation. Both are opt-in behind
`VITE_SAGIS_LIVE`, so the demo and the test suite stay offline and deterministic.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 336 tests, and a
production build. 53 of those tests are new. Every owner and PIN case in them is
a real value from the live service rather than an invented one.

Separately, and not part of `pnpm verify`, a live smoke test runs against the
real service with `VITE_SAGIS_SMOKE=1`. Six checks, all passing.

That smoke test immediately earned its place. It asserted that an unincorporated
county parcel has no zoning, on the reading that the zoning layer is City of
Savannah only, and it failed: `10011 02012C` is `R-1`. The layer sits under a
Savannah path but holds 1,846 polygons and 285 distinct codes covering the whole
county. 24 of 24 sampled parcels resolved, 12 city and 12 county. The
documentation, the blocker, and the code that acted on the wrong reading are all
corrected. Every other test here runs against a recorded payload, and a
recording cannot tell you a reading was wrong.

**Not done, and why.** Still no Supabase, no migrations, and no RLS: Docker is
not installed and the schema still needs `docs/BUILD-PLAN.md`. The provisional
relation types and per-type entity field lists were left as they are, ratified
as placeholders rather than corrected. No satellite basemap, since that is the
one thing needing a Mapbox token.

The `Property_Use` and `Municipality` code tables are not published on the
layer, so unmapped codes render literally rather than being given invented
labels. Zoning is treated as free text with a short lookup for readable labels,
because 285 codes with overlay suffixes is not a hand-maintained list.

**Next.** Install Docker, write the migrations, and swap `src/lib/data/index.ts`
to the Supabase provider. The parcel and geocoding seams are already swapped and
tested, so nothing in that work touches SAGIS. Ask the Board of Assessors for the
property class code table, and ask SAGIS whether the zoning layer's two code
vintages are documented anywhere.
