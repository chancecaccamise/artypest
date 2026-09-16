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

## 2026-08-24: finishing the neighborhoods the rectangle clipped

**Did.** Took the parcel layer from 10,399 lots to 16,656, and changed how
coverage is decided so that number means something.

*The rectangle was the bug.* Coverage was an envelope: MLK Jr Blvd to E Broad
Street, the river down to DeRenne. Savannah's grid is rotated, so it followed
those streets only in the Historic District and cut diagonally through
everywhere else. All 27 neighborhoods it touched came back clipped, and the
manifest said so honestly: North Historic District 1,708 of 1,740, Eastside 564
of 767, Ardmore 734 of 1,151. The whole River Street frontage was outside it.

*Coverage is now a list of names.* `scripts/sagis/coverage.mjs` holds the 27
neighborhoods. The harvest fetches each boundary from the neighborhood layer and
uses it as the query geometry, so the ID list it gets back is both what to
harvest and what the neighborhood holds. Adding a neighborhood is adding a line.

Two details cost a first attempt. Esri winds an outer ring clockwise and GeoJSON
winds it the other way, so the boundaries are read as `f=json` for the query and
`f=geojson` for the point-in-polygon assignment rather than converted between
the two. And a lot on a shared edge is returned by both neighbors, so the ID
sets are de-duplicated before the fetch.

*What that found.* 16,698 parcels, against 16,698 the service reports for the
union of the same boundaries. 313 W River St, 708 Ott St, and 17 E 52nd St did
not exist in the app yesterday; all three now search, open, and navigate to
their own lot on the plat. Every one of the association's own 40 platted lots is
inside the harvest now, where 29 of them used to fall outside it.

*A reporting bug I wrote and then caught.* The first run declared 15
neighborhoods incomplete. They were not. The service counts parcels that
intersect a boundary; the harvest assigns a lot to whichever neighborhood its
centroid falls in. Comparing the two as though the first were a target reports a
shortfall that is really 175 lots double counted on shared edges plus 42 centred
outside the selection. The manifest now carries both numbers under their own
names and an `accounting` block that has to add up: 16,698 fetched = 16,656
written + 42 centred outside + 0 duplicate PINs. The harvest fails if it does
not.

*The plat.* The draw ceiling went from 3,000 to 6,000, measured rather than
guessed by panning the full extent in headless Chrome: 37ms per frame at 3,000,
45ms at 6,000, 53ms at 9,000, 73ms with no cap. No cliff, just 2.7ms per extra
thousand lots. The measurement also found real waste: the largest-first ranking
that decides what survives the cap was being recomputed inside the per-frame
memo, so every frame of every pan re-sorted the on-screen lots. Sorting once per
projection took 5ms off every frame at every ceiling tested.

*Storage and boot.* 24MB across four files, still none of it committed except
the manifest. `attributes.json` went from 5.0MB to 8.0MB and it is fetched
before the first render, so that was measured too: 346ms to a usable directory
before, 443ms after. Not enough to justify splitting the file, which would have
cost the search index its recall over legal descriptions and mailing addresses.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 430 tests, and a
production build. The JS bundle did not move, because the layer is fetched and
never bundled. The harvest was checked against the service independently: a
`returnCountOnly` union query over the 27 boundaries reports 16,698 and the
harvest fetched 16,698. Two consecutive runs produced identical output. In the
running app: 16,664 properties in the directory, the dashboard still reads 48
lots, and the plat draws, pans, and navigates to a named lot.

**Not done, and why.** Still no Supabase, no migrations, no RLS: Docker is not
installed and the schema needs `docs/BUILD-PLAN.md`. Nothing refreshes the
harvest. The 4,755 street centrelines are drawn without viewport culling, which
is most of what the plat draws once zoomed in, and they grew by 58% with this
change; the parcels are culled and the streets are not. Coverage stops at the 27
neighborhoods that were already on the map, so the west side (Carver Heights,
Cuyler/Brownville, West Savannah) and everything south of DeRenne are still
absent by choice, not by accident.

## 2026-08-24: threads you can see, and how old they are

**Did.** Made the Connection Map draw connections as threads a reader can trace,
and gave both views a way to read how recent each connection is.

*Threads have a colour now.* Every edge on the Connection Map was drawn in one
grey, so a fan of eight lots under an association was eight identical lines. The
plat had coloured its arcs by connection type since it was built. Both now read
from `src/lib/relations/colors.ts`, so purple means "member of" on either
screen.

*Age, as brightness.* A new `Age` control on the Connection Map and a `Grade by
age` checkbox on the plat. Brighter means more recent. The ramp is linear in
elapsed time rather than in rank order, so seven lots that joined together stay
clustered at the dim end and the one that joined last year stands out on its
own. Ranking would have spread them evenly and implied a steady arrival that
never happened. A span under a fortnight is not graded at all.

*Graded within a group, which took a second attempt.* Built the obvious way,
with one ramp across everything on screen, it failed at the exact case it was
built for: on a board member's map, their own recently recorded address set the
top of the range and all six association lots collapsed into the dim end. The
ramp now runs per fan on the Connection Map and per connection type on the plat.
Brightness is therefore not comparable across two groups, and the legend says so
instead of leaving it to be inferred.

*Order agrees with brightness.* Cards in a row sort oldest to newest, so
leftmost is oldest is faintest, with ended connections still last and undated
ones after the dated. Position is the easier of the two to compare across a wide
row; brightness carries the size of the gaps.

*The dates existed for almost everything except the example.* Ownership,
residency, and board seats all carried `startDate`. The 48 property memberships
did not: they were seeded with none at all, so every thread graded identically.
They now carry clustered join dates spanning about 25 years.

*What is deliberately not read.* `createdAt` is never used as a fallback. A lot
that joined in 1998 and was typed in last Tuesday is an old relationship, and
reading the creation date would draw it as the newest thing on the map. Undated
connections sit at a fixed middle strength and are counted in the legend.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 448 tests, and a
production build. 18 of those tests are new, covering the time-linear ramp, the
undated and no-spread cases, chronological ordering, and the per-fan isolation
that the first attempt got wrong. Checked in the running app against the seeded
association: the fan grades floor to ceiling across a real span of years, and
the plat legend reports Sep 2000 to Dec 2025.

**A test that caught a real thing.** Asserting that memberships sort by date
failed on one that sorts last despite being recent. It has an end date, and
ended connections come after everything that is still true. The convention was
right and the assertion was wrong.

**Not done, and why.** Hovering a card does not yet light its whole thread and
dim the rest, which is what a map with 71 direct connections needs. The
association's own map is still a hairball at that size, which colour helps with
but does not solve. Neither view offers a time filter: you can see that a
connection is old, but not hide everything before a date.

## 2026-08-24: the plat opens where the records are

**Did.** Made the plat frame the association rather than the county.

*The complaint and what it turned out to be.* Connections were switched on and
nothing appeared to happen. They were being drawn the whole time: 45 arcs, right
colours, right grading. The plat frames 4.3 by 7.9 km of city and the
association's lots span 1.1 by 0.44 km, so the whole fan was about a sixtieth of
the drawing, which is smaller than the lines are thick.

*Not the parcel layer's fault, which was the first guess.* Measured against the
previous harvest: the association occupied about a sixteenth of the frame's long
side before and an eighteenth after. The plat had always opened on everything.
Going from 10,399 lots to 16,656 made an existing problem visible rather than
creating one.

*What it does now.* Opens framed on the records the association tracks, once,
when the harvested geometry lands. Switching a connection type on frames those
arcs, because switching them on is a request to look at them. A new control
returns to the records, and the old fit control, relabelled "Fit every lot the
county recorded", goes back out to the whole harvest.

*One bug found on the way.* The first version latched a "framed already" flag
while the plat still held only the committed 40-lot fixture, which is what it
draws until the harvested geometry is fetched. The flag was therefore set before
the 16,656 lots arrived, and the plat opened on the county anyway. The guard now
returns without latching until there is something real to frame.

*The arithmetic moved.* `frameTransform` sits in `projection.ts` beside the rest
of the projection maths, since it is the question `fitExtent` answers at build
time asked again at zoom time. Opening the plat, switching connections on, and
arriving at a record now frame things the same way instead of three slightly
different ways.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 455 tests, and a
production build. 7 of those are new, covering centring, the fill fraction, the
zoom clamps at both ends, a degenerate one-point area, and the magnification
that the whole change exists for. In the running app the plat now opens on
Ardsley Park with street names legible, and switching "Member of" on draws the
fan across the lots it belongs to.

**Two of those tests failed first, and were wrong.** Both assumed framing was
unclamped, and both were written with drawing-space numbers that ignored
`fitExtent` having already normalised the harvest to viewport scale. The clamps
and the projection were right.

**Not done, and why.** The plat frames the records but does not follow them: a
filter that narrows the visible set does not re-frame. The `Age` grading and the
thread colours are unchanged by this work.

## 2026-08-24: the database is connected, and the schema exists

**Did.** Wired the app to the hosted Supabase project and wrote the first
migration. The app still reads its demo data: connecting the database and
reading from it are two separate moves, and this is the first.

*The client.* `src/lib/supabase.ts` returns null rather than throwing when there
are no credentials, because that is the state of every fresh clone and the whole
test suite. It also refuses to start if the key it is handed looks like a
service role key, since anything prefixed `VITE_` is compiled into the public
bundle.

*The schema.* Seven tables, and the three structural rules from `CLAUDE.md`
enforced rather than remembered: one `entities` table with a type discriminator
and a JSONB `data` column, one `relations` table with real foreign keys on both
ends, and `org_id` plus row level security on every table including the lookup
tables. The audit log is triggers, writing one row per changed field, and it
covers relations as well as entities: "Unit 42 changed hands" is a relation, not
a field.

*Tested, before it touched anything real.* There is no Docker on this machine
and the database is hosted, so without this the first thing to run these
migrations would have been the client's only copy of their data. They now run on
every `pnpm test` against Postgres compiled to WebAssembly. Seventeen tests
cover the tables, RLS being on everywhere, every policy filtering on the org,
the bootstrap being idempotent, the constraints, and the audit triggers: one row
per changed field, both sides of each change recorded, no row at all for an
update that changed nothing, `updated_at` never logged, soft delete audited as
the field change it is, and one batch id grouping everything one action wrote.

*What it caught immediately.* `pgcrypto` was being created for nothing:
`gen_random_uuid()` has been core Postgres since 13. The extension is gone.

*A rule that had to change.* `CLAUDE.md` said "Never write against a remote
Supabase project. Local only." There is no container runtime on this machine and
8.4GB free, so that described something that could not happen. It now says
schema changes are migration files and never dashboard edits, which is the part
that was actually protecting anything.

*Visible.* Settings, Integrations now carries a Database panel that runs one
real query and says what came back, telling apart "no credentials", "connected
but the schema is not pushed yet", and "connected". Reading the browser console
is not an answer for a board member.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 472 tests, and a
production build.

**One thing the move surfaced.** `src/test/setup.ts` assumed a browser, so the
first node-environment test in the project failed during setup before a single
assertion ran. It is guarded now.

**Not done, and why.** No `SupabaseProvider`: the 30-method `DataProvider` is
still the in-memory one, and the swap needs auth decided first, because RLS with
no signed-in user correctly returns nothing. The 16,656 parcels are still served
as static JSON rather than rows. `src/types/database.ts` is not generated yet:
that needs the project linked, which needs credentials this machine does not
have.

## 2026-08-24: district overlays on the plat

**Did.** Built the boundary overlays the client asked for: sixteen of them, one
shown at a time, chosen from a picker on the plat.

*What was actually available.* The client's list was checked against all 1,334
layers SAGIS publishes across 165 services rather than guessed at. Built:
County Commission, Aldermanic, State House, State Senate, US Congressional,
voting precincts, police precincts, fire service districts, sanitation
collection days, school board districts, elementary, middle and high school
attendance zones, local historic districts, National Register districts, and
neighborhood associations.

Four items on the list are not published anywhere: District Attorney, Recorder's
Court and Grand Jury districts, Code Enforcement districts, the MPC Monuments
board, and the two tourism councils. The first read as county-wide
jurisdictions and the last as advisory bodies, so there may be nothing to draw
rather than something to go and find. Recorded in `DECISIONS.md` with what was
searched for.

*A correction.* Voting precincts were reported as unpublished a few days ago.
Only `OpenData/Boundaries` had been checked. They exist, at
`OpenData/Community/MapServer/17`, 87 of them.

*Two of these are richer than expected.* The voting precinct layer carries the
polling place and its address, so the overlay can say where a resident of that
precinct actually votes. The neighborhood association layer carries the
association's name and its contact, and records "No Active Neighborhood
Association" where there is none, which is exactly the sort of thing a board
wants to see on a map.

*Sanitation is four layers folded into one.* The city publishes a layer per
weekday rather than a day column. A reader wants to know which day a street is
collected, not to switch between four overlays to find out.

*Size.* Simplified by the service to about two metres and clipped to the
harvested extent, sixteen overlays are 656KB, fetched one at a time and cached
for the life of the page. Before that a single congressional district was 343KB
of Georgia coastline.

*The labels needed a second attempt.* The first version put each name at its
district's centroid, which drew 27 boundaries with 27 labels and none of them
visible: a voting precinct is far larger than the plat's opening view, so its
centroid is off screen. Labels are now slid to stay inside the part of the
district on screen, and positioned at the mean of the vertices rather than the
centre of the bounding box, because an L-shaped district's box centre sits
outside itself.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 489 tests, and a
production build. 17 of those are new, covering the loader's absent, offline and
served-index.html cases, per-id caching, and the projection: multipart
districts, the vertex-mean label, and the size at which a district earns a name.
Checked in the running app by switching between sanitation, neighborhood
associations, and commission districts and reading the labels off the plat.

**Not done, and why.** Selecting a lot does not tell you which district it falls
in, which is the question an overlay invites. That is point in polygon against
the active overlay and is the obvious next step. The point layers, fire stations
and polling places, are harvested as boundaries only: they are pins rather than
regions and want a separate toggle that can sit on top of an active overlay
rather than competing with it.

## 2026-08-24: the plat's colourings only ever coloured forty lots

**Did.** Fixed "Colour lots by", which appeared to do nothing.

*What was wrong.* `MapView` passed `platPins()` to the theming, which is the 40
lots in the committed fixture, while the plat draws 16,656. Every colouring
classified those forty and dropped the rest into "unknown". Measured in the
browser before touching anything: of the 2,124 lots on screen, picking Occupancy
coloured 40 and moved 2,084 from one flat grey to a slightly different one.

*The fix.* `pins` is now the fixture merged with the harvested layer, the same
union the projection draws. Occupancy and record completeness now colour all
2,124 lots on screen, and zoning colours 1,877 of them, the remainder being lots
the county has no zoning district for.

*A second bug found on the way.* `propertyByPin` was keyed on the raw `data.pin`
while every lookup asks with a normalised one. It works only while the county
and whoever typed the record agree on spacing, so a lot entered as
`20003-15001` was invisible to every colouring, in a way nobody could have
diagnosed from the screen.

*Property use is not broken, and was left alone.* It colours forty lots because
the association has recorded a use for forty lots. `propertyUse` is the
association's own reading of what is on a lot and is null for every county
parcel, deliberately: nobody has looked at them.

*What the client actually wanted is a new mode.* The county files its own class
code for all 16,656 parcels across 17 classes, so "Property class, as the county
has it" now colours the whole plat: 82% R3, 12% C3, and the commercial strip
along a main road is visible at a glance. Kept separate from property use rather
than filling one in from the other, because collapsing the two breaks the
"commercial use in a residential district" question. Buckets carry the raw code,
because the Board of Assessors has not published the code table and a guessed
label is worse than an unexplained one.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 494 tests, and a
production build. Five of those are new and guard the shape of the bug: a plat
larger than the fixture colours all of it, a PIN is found whatever spacing it
was typed with, the two commonest classes get different colours, and property
use stays empty on county land on purpose.

**Not done.** The class codes are still unlabelled. Asking the Board of
Assessors for the code table has been an open question since the SAGIS
investigation and this is now the second feature that would be better for it.

## 2026-08-25: sale history on every parcel, and associations as owners

**Did.** The first two of the four steps toward the client's per-parcel wish
list: the sale fields the county publishes, and a third kind of owner.

*Sale history.* `Sale_Price`, `Sale_YY`, `Sale_MM`, `Sale_DD` and
`Sale_Quality` are harvested now, and land on every property record as
`lastSaleDate`, `lastSalePrice` and `saleQualityCode`. 15,867 of the 16,656
parcels carry a transfer date, running from 1912 to 2025, and 10,684 carry a
price.

The price is null and never zero. A third of recorded transfers have no price
against them, because a gift, a family transfer and a foreclosure all move a
property with no consideration, and zero would read as "sold for nothing". The
card says "Transferred with no price recorded" rather than showing a blank.

The qualification code is shown beside the price and never instead of it.
Roughly half of sales carry `U` and half `Q`, only one of the two is an arm's
length sale by the convention used elsewhere in Georgia, and the Board of
Assessors publishes no code table, so the code is rendered literally next to the
number it qualifies.

*Associations.* `OwnerKind` has a third value, and the token list was chosen
against the real owner field rather than imagined. Two traps found by looking:
`HOA` prefix-matches `HOAGLAND` and `HOANG`, which are surnames here, and
`ASSOCIATES, LLC` is a partnership rather than an association. Churches,
temples and ministries stay filed as businesses, 135 records, because the
association reference list is homeowners association, committee, civic club and
property owners association and a congregation is none of those.

*Where the parsing now happens.* The three producers of a parcel record, the
harvest, the live service and the fixture generator, each build the sale date
the same way, and the fixture was regenerated from the county rather than hand
edited. Diffed against the previous one: identical except for the three new
fields.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 512 tests, and a
production build. 18 of those are new, covering impossible dates such as a 31st
of February, absent transfers, the two owner-name traps, government beating
association, and the committed sample never carrying a zero price.

**Three bugs this surfaced, all mine, all caught by tests.**

Adding a third owner kind broke the second: `parseOwner` skipped person parsing
with `kind === 'business'`, so every condominium association went to the person
parser and came back as somebody surnamed 37. It reads `kind !== 'person'` now.

The import created associations with `businessCategory` and
`stateFilingNumber`, keys their own form never shows. Each kind gets its own
fields now, and `associationDataSchema` gained the mailing address the county
publishes for every owner.

Adding two schema fields with no form field broke record creation entirely.
Every other property field has a form input, so the form always submits the key;
these two are county-owned and deliberately have none, and `nullable` alone
rejects an absent key. Both are `.optional()` now. Worth knowing before the next
county-owned field is added.

**An obsolete assertion, corrected rather than worked around.**
`ARDSLEY PARK CIVIC ASSOCIATION` was asserted to be a business, which was the
only right answer when there were two kinds. It is an association now.

**Next, and not done.** Steps three and four: reconciling owners across the
whole layer rather than one import at a time, and putting AI only on the
low-confidence residue. Measured against the real data, the existing rules
settle 86.4% of parcels confidently, 13.5% need judgement, and 5.9% are
truncated at 40 characters upstream and cannot be recovered by anything.

## 2026-08-25: owner reconciliation across the whole layer

**Did.** Step three of the client's owner request: reconciling every owner name
the county files against the directory.

Step four, a reading service for the names the rules cannot settle, was built
and then removed the same day at the client's request: no LLM is being connected
for now. The Vercel function, the SDK dependency, and the client that called it
are gone rather than left dormant. The reasoning worth keeping is recorded in
`DECISIONS.md`, and git history has the code.

*The screen.* Tools, Owner Reconciliation. It groups 16,592 lots into 13,493
distinct owner names, decides what to do with each, and applies the safe ones as
one audited batch. Measured on the real layer: 11,499 create, 1 links, 1,993
wait for a person, of which 860 are truncated by the county at 40 characters and
cannot be recovered by anything.

*The rule the whole thing is built on.* Creating a record is safe and
reversible; at worst there is a duplicate to merge. Linking a lot to an existing
person is neither, and a wrong link is silent. So a confident parse is enough to
create, linking needs a byte-identical name or a confident parse, and everything
else waits. `owner.ts` has said since the SAGIS investigation that a confident
wrong match is the worst thing this application can do; this is that applied to
the bulk case.

*Grouped, not per parcel.* 1,286 owners hold more than one lot and one holds
170. Deciding per parcel would ask the same question 170 times and make 170
copies of the same company.

*Speed.* The parcel import walks the candidate list per owner, which is right
for sixty parcels and would be 13,493 walks of several thousand records here.
The directory is indexed once instead: 69ms to reconcile the layer and 77ms to
apply it, writing 11,499 records and 14,379 ownerships under one batch id.

*Ownership carries a date.* Each `owns` relation starts on the county's last
recorded transfer, which is as close as the roll gets to when the ownership
began. It also makes the plat's age grading work on ownership for free: the
brightest thread becomes the lot that changed hands most recently.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 536 tests, and a
production build. 24 of those are new, covering the link and create asymmetry,
truncated names being acted on in neither direction, grouping and
case-insensitivity, and running the apply twice without doubling anything.

**A test that failed for the right reason.** `37 THE LOFTS CONDOMINIUM
ASSOCIATION INC` is exactly 40 characters, so it is indistinguishable from a
name that lost its end and correctly went to review rather than being created.
The test was wrong, not the rule.

**Said out loud on the screen.** Applying eleven thousand records in the demo is
several times what this browser's storage holds. The work is correct on screen
and will not survive a reload until Postgres is behind it, so the page says so
before the button is pressed rather than after.

**Not done, and why.** The review queue lists what needs a person and shows why,
but has no way to act on a row from the screen: resolving one is a write and
wants the same batching and audit the bulk apply already has. That is the next
piece, and it needs no model to be useful.

---

## The hand mark and the work log

Built from a client note: a panel keeping a running tab of what the analyst has
entered, so the last entry is visible while a printed list is being worked, and
a way to see at a glance whether a record has had a person's attention.

**What a reader sees.** A moss rule down the leading edge of every checked row
and card, with a badge that is also the control. Amber where a person checked a
record and the county has written to it since. Nothing at all on the records
nobody has been through, which is most of them, and deliberately the quiet
state. On a record's own page, a small moss dot beside each field somebody typed
rather than imported. A **Checked** filter on every directory, which is what
turns a list into a work queue: filter to "not checked yet", work down it, watch
it shrink.

**The panel.** Opens from a header button that carries the session count, docks
beside the list on a laptop, and becomes a sheet on a phone. It pins where you
were, so the question you come back with after looking at a piece of paper is
answered without scrolling; a progress meter for whatever list you are working,
with a link to what is left; and the running list itself, newest first, folded
so one save is one line and a four-hundred-lot import is one line rather than
four hundred.

**Two things this made me reconsider mid-build.**

*Ties.* When a check and an import land in the same millisecond, nothing in the
data says which came first. It was resolving in favour of the check. It now
resolves in favour of a recheck: of the two ways to be wrong, a green tick on a
record the county has rewritten is the one that costs something.

*Writes that change nothing.* The trigger claiming the mark on every hand write
also claimed it for updates that moved no value, which broke a schema invariant
the audit log already held and, worse, meant a re-save or a script could
manufacture a claim that a person had read something. It now compares the row
against itself with the bookkeeping columns removed, which is the same
comparison the audit trigger makes a few statements later.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 590 tests, and a
production build. 54 of those are new: the state rules, field provenance,
folding audit rows into log entries, the provider's behaviour under a hand write
and under an import, eleven driving the real pages through the router, and seven
running the trigger and the view against Postgres in `pnpm db:verify`.

**`pnpm db:verify` was testing nothing.** It pointed at
`src/lib/data/schema.test.ts`, which does not exist; the schema suite is
`supabase/schema.test.ts`. Repointed, and the migration's own behaviour added to
it, so the trigger and the `entity_review` view are exercised rather than
assumed.

**Not applied to the hosted database.** The migration is written, and it applies
and behaves correctly against Postgres in the test suite, but `pnpm db:push` has
not been run: pushing schema to a hosted project is the client's call, not mine.

**Not done, and why.** The Plat View does not shade lots by whether they have
been checked. It would be genuinely useful, a map of the backlog, but it is a
second rendering pass over 16,656 polygons and belongs with the map work rather
than bolted to this. The dashboard has no coverage widget for the same reason:
it is a different audience asking a different question, and the panel answers
the analyst's.

## 2026-09-16: staff sign-in

**Did.** Staff sign in with the email and password an administrator set up in
Supabase.

- `/sign-in`, outside the shell, built with React Hook Form and Zod. Separate,
  plain messages for a wrong password, an unconfirmed account, a suspended one,
  too many attempts, and a dropped connection, so nobody is told their password
  is wrong when it is the wifi
- Every other page is behind `RequireSignIn`. A signed-out visitor is sent to
  sign in and returned to the page they asked for. A saved sign-in reopens
  without the form
- The account must have an `org_users` row. Without one the page says the
  account has not been given access, and offers signing in as somebody else
- The role comes from that row. Only administrators see the role preview
  switcher
- Sign out in the header
- A production build with no database configured refuses to open rather than
  opening to everyone

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 618 tests, and a
production build. 14 are new and drive the real application through a real
Supabase client with a faked network: the redirect and return, each failure
message, the membership gate, restoring a saved sign-in, sign out, the role
switcher by role, and both no-database cases. Checked in a browser against the
dev server: `/people` signed out lands on the form.

**Needs doing before anybody can sign in.**

1. Give each account an `org_users` row. See "Staff sign-in" in `README.md`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the deployment's
   environment. Without them the deployed site now shows "Sign-in is not
   available", by design.
3. Turn off "Allow new users to sign up" in the Supabase dashboard. The
   membership check already stops a stranger's account at the door, but there
   is no reason to let one be created.

**Not done, and why.**

- *The records are still the in-memory ones.* Sign-in guards the application,
  but the demo fixtures ship in the JavaScript bundle and the harvested parcels
  are static files under `public/`, fetchable by URL. The county data is public
  anyway. Real protection of the association's own records is row level
  security, which applies once the Supabase provider replaces the in-memory one.
- *Changes are not yet attributed to the signed-in person.* The in-memory
  provider still names its fixture user as the actor, so Activity and the work
  log say that rather than the account. The Supabase provider gets this from the
  audit triggers, which already read the signed-in email.
- *No password reset by email.* See `DECISIONS.md`.
- *One association per account.* The earliest `org_users` row wins. Choosing
  between associations waits until somebody belongs to two.

## 2026-09-16: Needs attention follows you onto the record

**Did.** A record's page now shows the dashboard's Needs attention lines about
that record, above the tabs. Following "Gerald Pinckney, Secretary of Ardsley
Park Homeowners Association, term ends" from the dashboard lands on his page
with that same line on it, the date and how far away it is, and a button to
where it gets fixed: Open connections for terms, contracts, insurance, and a
missing owner; the edit form, focused on the right field, for a missing parcel
number, contact, or follow-up date. Residents get no edit buttons. A record with
nothing wrong shows nothing.

*One set of rules.* `needsAttentionFor` in `src/lib/insights.ts` runs the same
rules as the dashboard over only the relations touching the record, then keeps
the items about it. Each item now carries a `kind`, which is what picks the
button, rather than parsing its wording.

**Verified.** `pnpm verify` passes: typecheck, lint (0 errors), 626 tests, and a
production build. 8 are new, including one asserting that for every record in
the demo data the record's lines are exactly the dashboard's lines for it, in
the same order. Checked in a browser on Gerald Pinckney's page with the full
harvested layer loaded.

**Not done.** A board term shows on the person, not on the association the seat
belongs to, because that is where the dashboard links. The association's page
could reasonably list its seats that are ending too.
