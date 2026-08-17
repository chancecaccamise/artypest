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

## 2026-08-17: the corridor, MLK to E Broad, river to DeRenne

**Did.** Replaced the 60-parcel single-street fixture with 10,399 real parcels
covering the corridor from the Savannah River down to DeRenne Avenue, between
MLK Jr Blvd and E Broad Street. That is both Historic Districts, Thomas Square,
Midtown, Live Oak, Beach Institute, the Victorian districts, and most of Ardsley
Park, across 27 neighborhoods.

*Why the old fixture was so small.* It was selected by an address predicate,
`PropAddress_StreetName='49TH'`, which is one street. Everything else was missing
because nothing had ever asked for it.

*The bug that mattered.* SAGIS truncates any query returning geometry and reports
it only through an `exceededTransferLimit` flag. Asking for 2000 features returns
1957, asking for 60 returns 53, asking for 500 returns 487. So `resultOffset`
paging, which the old generator used, silently drops 2% to 12% of rows. That is
exactly how a map ends up missing a neighborhood.

Two things do not have that problem: `returnIdsOnly` returns the complete
OBJECTID list in one request, and fetching by explicit `objectIds` returns
precisely what was asked for. `scripts/sagis/harvest.mjs` asks for the manifest,
fetches those IDs in chunks of 250, and asserts every one came back. Coverage is
checked rather than hoped for.

*Coverage is a contract.* `scripts/sagis/coverage.mjs` holds the corridor bounds,
taken from real street centreline geometry rather than drawn by eye. Every parcel
is tagged with the neighborhood containing its centroid, and
`src/lib/parcels/coverage-manifest.json`, which is committed, records harvested
against total for each of the 27. A partial clip like "Eastside 564 of 767" is
visible as a decision instead of being mistaken later for a gap.

*Storage.* 14MB across three files, none committed. `data/sagis/parcels.ndjson`
is one JSON object per line, which is what loads into Postgres, so the harvest is
not thrown away at the swap. The app fetches `public/parcels/attributes.json`
before first render and lazy-loads the geometry only when the map opens. Neither
is bundled: the JS bundle did not move.

*One record per parcel, without breaking the dashboard.* Every parcel is a
property record, so the directory lists all 10,436. Association membership is now
a `member_of` relation to the association, the same shape `CLAUDE.md` specifies
for board seats, and `computeStats` and `computeOccupancy` read that instead of
every property. The dashboard still says 48 lots at 54% owner occupied.

Owner entities were deliberately not expanded. That would add roughly 8,000 more
people and businesses, and the parcel import is the feature that exists to create
owners deliberately. County owner names sit on the property record, so they stay
searchable.

*The plat.* Viewport culling in `PlatView.tsx`, with a 3,000 lot ceiling and an
on-screen notice when it bites, because a plat that has quietly dropped two
thirds of the city looks exactly like a plat of a smaller city.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 350 tests, and a
production build. The harvest was checked against the service independently: a
`returnCountOnly` query reports 10,399 for the corridor and the harvest wrote
10,399, and two spot-checked PINs match the live records field for field. The
real 10,399 records were run through the whole boot path: 10,436 properties,
10,527 entities, built in 56ms, audit log still 54 entries.

**Two things this surfaced, both real bugs.** `at()` wraps with modulo, so
growing the `properties` array from 48 to 10,447 silently re-pointed a dozen
fixed indices at county parcels and moved the occupancy figures. County parcels
are now appended only after the association's own data is fully wired. And Vite
answers an unknown path with `index.html` at status 200, so the loader checks the
content type before believing it found a slice, which is verified against the
real dev server.

**Not done, and why.** Still no Supabase, no migrations, no RLS: Docker is not
installed and the schema needs `docs/BUILD-PLAN.md`. Nothing refreshes the
harvest. The corridor is a rectangle in latitude and longitude while Savannah's
grid is rotated, so its edges follow MLK and E Broad exactly only in the Historic
District and drift slightly further south.

**Next.** Install Docker, write the migrations, and load `parcels.ndjson` into
Postgres. `initializeData` and the served slice both go away with the provider
swap, which is the point of writing the harvest out in that shape.

## 2026-08-17: global search

**Did.** Replaced the header's "Search arrives in Phase 2" placeholder with
working search over every record.

*Ranking.* `src/lib/search.ts`, pure and tested. It stands in for the Postgres
side of this, which is a `search_vector` column, a pg_trgm index, and a trigger
to maintain it, so the ordering rules here are the ones that become `ts_rank`
weights later and the behaviour a board member learns now is the behaviour they
keep.

Words match in any order across the name, the address, the parcel number, the
county owner, and the neighborhood, and punctuation is dropped on both sides, so
`1402 E. 49th St.` and `20003-15001` both find what the reader meant. An exact
name beats a name that starts with the query, which beats a name containing all
the words, which beats a match in the address, which beats a match anywhere
else. Shorter names win ties, which is why `10 whitaker` returns
`10 WHITAKER ST` above `1005 WHITAKER ST`.

Every string and number in `data` is indexed rather than a fixed field list,
because the per-type field lists are still provisional and a whitelist would
quietly stop finding things the day a field is renamed. Notes are excluded: they
are internal, and never rendered for a resident.

*Reach.* Searching an address returns the lot and the people whose mailing
address is that lot. Searching a county owner returns their land, which matters
because owner names sit on the parcel rather than becoming records of their own,
so this is the only route from an owner to their property. Deleted records never
answer; archived ones do, ranked below live ones, because "where did that lot go"
is a real question.

*The control.* A proper combobox in `src/components/layout/SearchBar.tsx`:
`/` to focus, arrows to move, Enter to open, Escape to close and again to clear,
results grouped by kind with the strongest match deciding which group leads. It
is drivable from the keyboard alone.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 384 tests, and a
production build. 25 of those tests are new.

Measured against the real corridor rather than the demo: 10,527 records, index
built once in 36ms, and every query answered in 1 to 2ms. `10 whitaker`, the
query from the report, returns `10 WHITAKER ST` first.

**Not done, and why.** The search box is still hidden below the `sm` breakpoint,
as it was before. Relations are not searchable as such: a record is found by its
own fields, not by the name of something it connects to. Both are worth doing
and neither is what was asked for here.

## 2026-08-17: the people directory as cards, with photographs that persist

**Did.** Rebuilt the People directory as cards, added photographs and public
biographies, and made work survive a page refresh.

*Cards.* `PersonCard` leads with the photograph, then how to reach the person,
then a short biography, then what they are connected to. Those connection counts
are the point of the whole card: "two properties, one association" is the
question this application exists to answer and it should not need a click. The
card carries its own controls: open, show on the Connection Map, edit, archive,
delete.

Only People. Properties now holds 10,436 records and cards would be unusable
there, so everything else keeps the table. The filter bar, search, archived
toggle, and pager are shared, and the pager was extracted so the two views
cannot drift apart.

*Photographs.* Chosen from the computer, downscaled in the browser to 320 pixels
on the long edge, and kept on the record as a data URL. Downscaling is not a
nicety: a phone photograph is several megabytes, a browser holds about five in
total, and thirty residents would fill it with the first handful. At 320 pixels a
face is about 25KB. When Storage arrives this becomes an upload returning a URL
and nothing else changes, because the record already holds a string.

*Biography, distinct from notes.* `bio` is public and appears on the card.
`notes` stays internal and is still never rendered for a resident.

*Work that survives a refresh.* Nothing did before: the store was rebuilt from
fixtures on every load. Saving the whole store is not possible and would not be
right, since it is 10,527 records of which almost all are county parcels that
should be rebuilt from the county. So what is saved is the difference between the
store and the freshly built baseline: records created, changed, or removed, and
the audit trail of those actions. A few dozen kilobytes instead of several
megabytes.

That split is the one Supabase inherits. The overlay is the user's data and
becomes rows; the baseline is the parcel layer and becomes a table loaded from
`data/sagis/parcels.ndjson`.

Settings gained a Saved work panel: what is kept, that it is on one machine only,
and a way to discard it and get the demo back.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 419 tests, and a
production build. 35 of those tests are new, covering the overlay diff and
restore, the storage failure paths including a full quota, photo downscaling and
validation, and the card view end to end.

**A real bug this surfaced.** The provider replaces `data` wholesale on update,
and the edit form only submits the fields in its config. So a photograph would
have vanished the moment somebody corrected a phone number, and any edit to a
county parcel would have silently dropped its neighborhood, county owner, and
legal description, which are not form fields. The form now carries unmanaged keys
through.

**Not done, and why.** Documents attached to a person are related `document`
records, which the Connections tab already shows; file upload still waits on
Supabase Storage. Saved work lives in one browser on one machine and is not
backed up, which the Settings panel says plainly. Cards are People only.

## 2026-08-17: editing a record from its own profile

**Did.** Made the record's tabs a place to work rather than only to read.

*Connections are editable.* This was labelled "arrives in Phase 2" and now
exists. `AddConnectionDialog` picks the kind of connection, the direction, the
record to connect to (searched with the same ranking the header search uses), and
an optional start date. Direction is chosen in the reader's own words using the
relation type's own labels, and the dialog shows the sentence the connection will
read as before it is saved, because a relation is stored once and read from both
ends: `owns` the wrong way round says a lot owns a person.

Removal asks first, and says that if the connection simply ended, giving it an
end date keeps the history instead. Relation changes are audited already, which
is what makes "Unit 42 changed hands" appear in the log.

*Images.* A tab per record holding up to twelve, through the same pipeline as the
profile photograph: chosen from the computer, downscaled to 320 pixels, kept on
the record. Any one of them can be made the profile photograph, and removing the
one that currently is does not leave the card pointing at something gone.

*Counts on the tabs.* Connections and Images carry theirs, so a reader can see
there are two connections and no images without opening either. A zero is shown
rather than hidden, because "nothing here" is an answer.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 430 tests, and a
production build. 17 of those are new, covering the direction sentence, the
refusal to save without a target, the audit trail, the image count, and the
profile-photograph edge case.

**A real bug this surfaced, in the shared dialog.** Its focus effect depended on
`onClose`. Most callers pass an inline handler, so the effect re-ran on every
render, and its cleanup returns focus to whatever opened the dialog. Typing into
any field in a dialog that re-renders as you type therefore lost focus after the
first character, and every character after it. The connection search made it
obvious because it re-renders on each keystroke. The handler is held in a ref
now and the effect depends on `open` alone.

**Not done, and why.** Connection attributes beyond the start date, such as a
board role or a term, are not editable here yet; the seeded data has them and the
editor does not write them. File upload still waits on Supabase Storage: images
are not files.
