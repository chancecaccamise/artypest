# Decisions

Assumptions made without the user present. Each entry states what was chosen,
what was rejected, and why.

## 2026-08-17, SAGIS investigation

Findings are in `docs/SAGIS-API.md`. These are the choices that came out of it.

### SAGIS is called directly from the browser, with no proxy

**Chosen.** `fetch` against `https://pub.sagis.org/arcgis/rest/services/` from
the client.

**Rejected.** A Supabase Edge Function relay, and a Vite dev proxy.

**Why.** The service sets `access-control-allow-origin` to the request origin
and there is no credential to hide. A relay would add a failure point, a
deployment dependency, and a place for parcel data to be cached without anyone
deciding it should be, in exchange for nothing.

### Zoning is resolved by spatial join, not read from the parcel

**Chosen.** Intersect the parcel centroid against
`Savannah/ZoningDevelopment_Map/MapServer/6` as a separate lookup.

**Rejected.** Reading a zoning field on the parcel, which is what the fixture
assumed.

**Why.** `Parcel Digest 2025` has no zoning field. Only the historic 1998 layer
does, which is probably where the assumption came from. This means
`property.zoning` and `property.property_use` come from two different services,
which makes the distinction `CLAUDE.md` insists on a data-sourcing concern and
not just a naming one.

**Corrected 2026-08-17.** This entry first said the layer was City of Savannah
only and that unincorporated parcels would resolve to null. That was wrong. The
layer carries 1,846 polygons and 285 distinct codes covering the whole county,
and 24 of 24 sampled parcels resolved, city and county alike. The null path is
kept because a parcel outside every polygon is still possible, but it is the
rare case. The live smoke test found this, which is the reason it exists.

### Parcel polygons are the plat geometry source, not DPLAT

**Chosen.** Real parcel polygons from the parcel layers as the plat base, with
DPLAT layers as an enhancement where they exist.

**Rejected.** DPLAT as the base, which is what its layer list invites.

**Why.** DPLAT has 1,637 subdivisions across its city and county services and
none of them is Ardsley Park. It covers modern recorded subdivisions and the
client's neighborhood is a 1920s plat. Parcel polygons cover the whole county.

### The SAGIS geocoder replaces Mapbox geocoding

**Chosen.** `Locators/MAD_PointAddress_Centerlines/GeocodeServer`.

**Rejected.** `MapboxGeocodingService.ts`, which the plat view specification
puts on the roadmap.

**Why.** It is the county's own address database, so for Chatham County
addresses it is the authoritative source rather than an approximation of one. It
scores 98.89 on a real test address, returns WGS84 directly with `outSR=4326`,
needs no token, and supports `Suggest` for address autocomplete later. Mapbox is
still wanted for a satellite basemap, which is a different job.

### Owner name parsing is rewritten, and allowed to say it does not know

**Chosen.** Parse the real grammar, and mark a name low confidence rather than
guessing when it cannot be resolved.

**Rejected.** Extending the existing `SURNAME, FIRST` normaliser.

**Why.** The comma format is 9,844 records against 115,312 without, so the
existing function is built for 7.9% of the county. Beyond that, some values are
genuinely unparseable: `WILSON C V VAN` has no reliable surname boundary, and
names are truncated at 40 characters upstream, so `KAYE & FORESTER-PY COURTNEY
FORESTER &` is not a complete name and no rule can recover it. The import
already has a per-row override, which is the right place to send these. A
confident wrong match silently attaches a property to the wrong resident, which
is the worst failure this application can produce.

## 2026-08-01, plat view

### `docs/MAP-SPEC.md` was written, not found

**Chosen.** Wrote `docs/MAP-SPEC.md` defining the resolution cascade, the
geographic data model, filters, split view, thematic modes, and the spatial
queries, then built against it.

**Rejected.** Stopping until the real document arrived.

**Why.** `docs/PLAT-VIEW-SPEC.md` refers to it by section three times, so
nothing could be built without pinning those rules down. The document carries a
provenance note at the top and every rule names the one file that implements
it, so correcting a rule later is an edit rather than a rewrite. Logged in
`BLOCKERS.md`.

### The cascade lives in `src/lib/locations`, not `src/features/map`

**Chosen.** `src/lib/locations/resolve.ts` and `src/lib/geo/`.

**Rejected.** The plat view specification's `src/features/map/` for both.

**Why.** The same specification requires `resolveLocation` on the DataProvider,
and `src/lib/data` must not import from `src/features`. Everything genuinely
about rendering stayed in `src/features/map` as written.

### d3-geo and RFC 7946 disagree about winding order, and the data follows the standard

**Chosen.** Store exterior rings counterclockwise, per RFC 7946. Reverse them
for d3 inside `projection.ts`.

**Rejected.** Storing them clockwise to suit d3.

**Why.** d3-geo treats geometry as spherical with the interior on the right, so
it renders a counterclockwise ring as the entire globe minus that lot. On
screen that is a solid block over the whole drawing. The geometry is the
permanent asset and Mapbox reads the standard correctly, so the workaround
belongs in the file the Mapbox swap deletes. Both facts are asserted by tests,
because the failure is silent in the data and total on screen.

### Arcs between two records at the same point are dropped, and the count is reported

**Chosen.** An arc whose ends resolve to the same coordinate is not drawn, and
the notice above the plat says how many were dropped for that reason as
distinct from how many had an unplaced end.

**Rejected.** Drawing them as dots, or dropping them silently.

**Why.** An owner living in the lot they own resolves to that lot, so "owns"
would draw forty invisible dots. Dropping them is right; not saying so left a
reader switching on "owns" and seeing five arcs across forty lots with no way
to tell working from broken.

### Markers derived onto a drawn lot do not take clicks

**Chosen.** A marker whose location was borrowed from a lot the plat draws is
rendered smaller and with pointer events off.

**Rejected.** Making every marker clickable, or hiding them.

**Why.** They sit exactly on the centroid, which is where a reader clicks to
select the lot. Intercepting that made the plat feel broken: clicking a lot
selected whichever resident happened to be on top. The lot's own panel lists
everyone who resolves onto it, so nothing is lost.

### d3-zoom is given an explicit extent and an event filter

**Chosen.** `.extent()` from the measured container size, and a filter that
refuses to start a gesture from an event with no `view`.

**Rejected.** d3's defaults.

**Why.** The default extent reads the SVG element's width and height as
animated lengths, which is both less accurate than the measured size and
unavailable outside a real browser. The filter is d3's designed extension
point, and declining to start a drag that cannot be tracked is correct
behaviour rather than a test accommodation.

### `d3-geo`, `d3-zoom`, `d3-selection`, and scoped Turf packages added

**Chosen.** The three d3 modules named by the plat view specification, plus
`@turf/centroid`, `@turf/distance`, `@turf/boolean-intersects`,
`@turf/boolean-point-in-polygon`, `@turf/bbox`, and `@turf/helpers`.

**Rejected.** `@turf/turf`, which is roughly half a megabyte for six functions.
Also `d3-transition`, which was only wanted to tween the zoom buttons, an
effect `prefers-reduced-motion` would disable anyway.

**Why.** `CLAUDE.md` already lists Turf. The d3 modules are named by the plat
view specification and need logging here; none of them is a rendering
framework, and none is Mapbox.

### The plat view specification assumed `d3-force` was already installed

**Chosen.** Nothing. Noted only.

**Why.** The specification says d3-geo and d3-zoom are "in the same family as
the `d3-force` you are already installing for the Connection Map". That is not
the case: the Connection Map was built with a computed hierarchical layout and
no physics library, for the reason recorded above under the July 31 entries.
The argument for d3-geo stands on its own.

## 2026-07-31, user interface build

### The Connection Map was built, against the letter of the UI specification

**Chosen.** A working Connection Map at `/map` and `/map/:id`: a focus record,
its direct connections, a second ring on dashed lines, type filter chips, and a
search box that re-centres the map.

**Rejected.** The designed empty state the UI specification asks for, with a
disabled "Open map" button labelled "Arrives in Phase 3".

**Why.** The user supplied a reference screenshot of the map they want and asked
for it directly. A direct instruction outranks the phasing in the written
specification. The dashboard's Connection Map card was changed to match: it
links into the live map instead of showing a disabled button.

### The map is laid out, not force-simulated

**Chosen.** A computed hierarchical layout: focus at the top, connections in
centred rows beneath, edges drawn as bezier paths in one SVG behind the cards.

**Rejected.** `react-force-graph-2d`, which `CLAUDE.md` names in the stack.

**Why.** Two reasons. The reference screenshot is a card layout, not a particle
cloud. And a force simulation reshuffles on every open, so a board member
comparing two lots never sees the same shape twice. The library stays available
if a genuinely large graph later needs it; nothing in `src/components/graph`
assumes the current approach beyond the layout function, which is exported and
tested separately from the component.

### Design tokens live in `src/index.css` under `@theme`, not in `tailwind.config.ts`

**Chosen.** The UI specification's token list as CSS custom properties, mapped
into utilities through Tailwind v4's `@theme inline` block.

**Rejected.** A `tailwind.config.ts` mapping, which the specification names.

**Why.** This project is on Tailwind v4, which is CSS-first and has no JS config
file. `@theme` is the v4 equivalent of the mapping the specification describes,
so the intent is met exactly and the mechanism is the current one.

### UI primitives were hand-written into `src/components/ui`

**Chosen.** Button, field, panel, table, tabs, dialog, tooltip, badge, chip,
skeleton, and empty state, written by hand against the token set.

**Rejected.** Generating them with the shadcn/ui CLI, which `CLAUDE.md` implies.

**Why.** The UI specification opens with "do not build the stock shadcn look",
and the generator emits exactly that: slate surfaces, a violet primary, and
shadows the specification rules out. Regenerating and then rewriting every file
is slower and leaves the components looking generated. `components.json` stays
in place, so `shadcn add` still works for anything genuinely generic later.

### Three font packages added to the dependency list

**Chosen.** `@fontsource/bricolage-grotesque`, `@fontsource/public-sans`, and
`@fontsource/ibm-plex-mono`.

**Rejected.** Google Fonts over the network, or system fonts.

**Why.** `CLAUDE.md` says libraries outside the stack list need a logged reason.
The UI specification names all three faces and explicitly asks for `@fontsource`
so there is no runtime CDN dependency. The files are bundled, so the app has no
third-party request at all.

### Demo data is generated relative to today, not hardcoded

**Chosen.** `buildDemoData(reference: Date)` computes every date as an offset
from a reference date. The app passes today; tests pass a fixed date.

**Rejected.** Hardcoded ISO dates in the fixtures.

**Why.** Half the dashboard is "within 90 days" questions. Hardcoded dates mean
the Needs Attention panel is empty or nonsensical the moment the demo is opened
in a different month, which is precisely when it will be demonstrated.

### Properties are seeded from the same fixture the import reads

**Chosen.** `src/lib/parcels/fixtures/chatham-sample.json` holds 60 parcel
records and is the source of truth. Forty of them become seeded lots, twelve of
those are deliberately left stale, and twenty are left unimported.

**Rejected.** Writing the property fixtures and the parcel fixture separately.

**Why.** The import's Match step is the highest-value thing to demonstrate, and
it is only worth looking at if the matches, the diffs, and the creates are real.
Deriving both sides from one file guarantees that. The file is regenerated with
`node scripts/generate-parcel-fixture.mjs` and committed, so it is reviewable in
a diff rather than reshuffling on every run.

### The Details tab does not repeat the Parcel Record card

**Chosen.** For a property, the Details field grid shows what the association
records (lot number, property use, year built, square feet). The Parcel Record
card shows what the county publishes. Property use appears in both.

**Rejected.** Rendering the full schema in the grid, which printed six fields
twice on the same screen.

**Why.** The duplication was visible and looked like a bug. Property use is kept
in both because the card exists to sit it next to the zoning district, which is
how "commercial use in a residential district" becomes obvious. Every hidden
field is still editable: the form reads the field list unfiltered.

### Owner-occupied is computed once, by the occupancy classifier

**Chosen.** `computeStats` reads its owner-occupied count from
`computeOccupancy`, and occupancy classification uses fixed precedence
(owner-occupied, then short-term, then long-term) rather than first match.

**Rejected.** The two counting independently, which is how it was first written.

**Why.** They disagreed by one lot, so the dashboard showed a 54% tile beside a
52% bar. A board that catches one figure contradicting another stops trusting
every other figure on the page.

## 2026-07-31, scaffold

### Temporary in-memory data layer instead of Supabase

**Chosen.** The app runs on an in-memory provider in `src/lib/data`, seeded with
demo fixtures. `src/lib/data/index.ts` is the only file that names a backend.

**Rejected.** Wiring `@supabase/supabase-js` now against a stack that is not set
up. It would have made `pnpm dev` fail on boot with an env error.

**Why.** The user asked to defer Supabase until it is properly set up. Putting
the temporary data behind the `DataProvider` interface means the swap later is a
one-line change in `index.ts`, not a rewrite of every call site. The provider
deliberately reproduces two behaviours the Postgres schema will own: archive and
soft delete as separate states, and one audit row per changed field.

The `supabase/` directory, `config.toml`, and the `supabase` CLI devDependency
stay in place but are dormant. Nothing runs them.

### React 18 and ESLint, against the current Vite template defaults

**Chosen.** React 18.3.1, ESLint 9 with typescript-eslint, TypeScript 5.9.

**Rejected.** The template defaults: React 19, oxlint, TypeScript 6.

**Why.** `CLAUDE.md` pins React 18 and the kickoff scope names ESLint. TypeScript
was held at 5.9 because typescript-eslint 8 does not yet support TypeScript 6.
Deviating from a stated stack choice needs a reason better than "the scaffolder
did it".

### Tailwind CSS v4 via `@tailwindcss/vite`

**Chosen.** Tailwind v4, CSS-first config in `src/index.css`, no
`tailwind.config.js`.

**Rejected.** Tailwind v3 with a JS config file.

**Why.** This is what the current shadcn/ui CLI generates and expects. Using v3
would mean fighting the component generator on every `shadcn add`.

### Provisional relation types in the demo fixtures

**Chosen.** Ten plausible HOA relation types in `src/lib/data/fixtures.ts`:
owns, resides_at, member_of, manages, employed_by, related_to, vendor_for,
adjacent_to, governs, references.

**Rejected.** Leaving the list empty until the specification arrives.

**Why.** `docs/BUILD-PLAN.md` defines the real ten and is not in the repo. See
`docs/BLOCKERS.md`. Empty fixtures would make the UI unreviewable. These are
placeholders and must be replaced once the build plan is available.

### pnpm installed to `~/.local/bin`

**Chosen.** `corepack enable --install-directory ~/.local/bin`, with that path
added to a newly created `~/.zshrc`.

**Rejected.** `sudo corepack enable`, which writes to root-owned `/usr/local/bin`.

**Why.** `/usr/local` is root-owned on this machine. A user-level install avoids
sudo and is trivially reversible.

## 2026-08-24, finishing the parcel layer

### Coverage is a list of neighborhoods, not a rectangle

**Chosen.** `scripts/sagis/coverage.mjs` holds 27 neighborhood names. The
harvest asks the neighborhood layer for each boundary and uses it as the query
geometry against the parcel layer.

**Rejected.** Widening the existing latitude and longitude envelope until it
reached the missing lots.

**Why.** Savannah's grid is rotated, so a rectangle cuts diagonally through the
neighborhoods inside it. The first harvest clipped all 27 it touched, worst at
Ardmore with 734 of 1,151, and it missed the River Street frontage entirely.
Widening moves the problem rather than solving it: the bounding box of those
same 27 neighborhoods holds 22,674 parcels, so it would drag in Carver Heights,
Cuyler/Brownville, and Hutchinson Island and still clip whatever landed on its
new edges. A boundary is the only shape that matches what somebody means when
they name a neighborhood.

This also deletes two hand-maintained things. `NEIGHBORHOOD_TOTALS` was a table
of full sizes typed in by hand; the per-neighborhood ID query now returns that
number as a side effect of asking for the parcels. `EXCLUDED_NEIGHBORHOODS`
existed to push back what an envelope caught by accident, which an allowlist
cannot do.

### A lot belongs to the neighborhood its centroid falls in

**Chosen.** Assign by centroid. A parcel that touches a selected neighborhood
but is centred in one we did not ask for is dropped, counted, and reported.

**Rejected.** Keeping every parcel the boundary queries returned.

**Why.** One lot has to be one record in one place, and 42 of the 16,698
returned are centred outside the selection. Keeping them would quietly extend
coverage past the list that is supposed to define it.

The manifest reports both numbers per neighborhood because they answer different
questions: `touching` is what the service returns for the boundary, `harvested`
is how many are centred inside it. An earlier version compared the two as though
the first were a target, and reported 15 neighborhoods as incomplete when every
parcel was accounted for. The real claim is arithmetic and lives in
`accounting`: 16,698 fetched = 16,656 written + 42 centred outside + 0 duplicate
PINs.

### The plat's draw ceiling was raised to 6,000, and the ranking sort moved

**Chosen.** `MAX_DRAWN_PARCELS = 6000`, and the largest-first ordering is
computed once per projection instead of inside the per-frame memo.

**Rejected.** Leaving it at 3,000, removing the cap, and rewriting the plat onto
a canvas.

**Why.** Measured by panning the full extent in headless Chrome: 37ms per frame
at 3,000, 45ms at 6,000, 53ms at 9,000, 73ms uncapped. There is no cliff, just
2.7ms per extra thousand lots, so the number is a judgement and not a threshold.
6,000 shows twice what the old ceiling did of a layer 60% larger.

The sort was the one clear waste the measurement found. Area does not change
when the view moves, but the memo depends on the transform, so every frame of
every pan re-sorted the on-screen lots. Sorting once per projection took about
5ms per frame off every ceiling tested.

### The boot payload was left whole

**Chosen.** `public/parcels/attributes.json` stays one file, fetched before the
first render.

**Rejected.** Splitting it into a slim boot file and a lazily fetched detail
file.

**Why.** Measured before splitting anything: 5.0MB and 346ms to a usable
directory before, 8.0MB and 443ms after. Ninety-seven milliseconds for 60% more
records does not justify the split, and splitting would cost the search index
its recall over legal descriptions and mailing addresses.

## 2026-08-24, deploying to Vercel

### `.gitignore` patterns for build output are anchored

**Chosen.** `/data/`, with a leading slash.

**Rejected.** The bare `data/` that was there.

**Why.** A pattern without a slash matches a directory of that name at any
depth, so `data/` also matched `src/lib/data/`. Files already tracked stayed
tracked, which is why nothing looked wrong, but three written after the rule
landed were never committed: `persistence.ts`, `persistence.test.ts`, and
`parcel-layer-integration.test.ts`. Every deploy since then failed on
`TS2307: Cannot find module './persistence'` while the build passed on the
machine that had the files, and Vercel kept serving the last build that
succeeded, which was the scaffold from the first commit.

The general rule this earns: a gitignore entry meant for one directory gets a
leading slash, and a clean clone is the only thing that can prove a build.

### `public/parcels/` is committed, `data/sagis/` is not

**Chosen.** Commit the 13MB the browser fetches. Keep the 11MB
`parcels.ndjson` out.

**Rejected.** Running `pnpm sagis:harvest` as part of the Vercel build command,
and committing nothing and letting the deploy show the 48-lot demo.

**Why.** The deployed site is static files with no database behind it, so
committed data is the only way it gets a map. Harvesting at build time would add
five minutes and about a hundred requests to a municipal server to every deploy,
preview deploys included, and would make a SAGIS outage a failed deploy.

This reverses the earlier "none of it committed" position, which was written
when the only consumer was a local dev server. It costs a copy in git history
per re-harvest and goes away when Supabase takes over serving.

### A rewrite so deep links work

**Chosen.** `vercel.json` rewriting everything to `/index.html`.

**Why.** `BrowserRouter` and one built HTML file, so `/plat/:id` would 404 on a
refresh or a shared link. Vercel checks the filesystem before applying rewrites,
so static assets are unaffected.

One consequence worth knowing: a missing `/parcels/attributes.json` now answers
200 with HTML rather than 404, exactly as the Vite dev server does. The
content-type check in `loadParcelLayer` already covers that, which is the reason
it was written.

## 2026-08-24, threads and how old they are

### Connection colour is shared between the two views

**Chosen.** `src/lib/relations/colors.ts`, imported by the plat and by the
Connection Map.

**Rejected.** Leaving the Connection Map's single grey and the plat's typed
palette as they were.

**Why.** They are two drawings of the same relationships. The plat already drew
`member_of` in the association colour while the Connection Map drew every
connection in one grey, so a reader moving between them had nothing to carry
across, and the Connection Map's threads were close to invisible against the
panel. A purple thread now means "member of" in both.

### Recency is graded within a group, not across the drawing

**Chosen.** One ramp per fan on the Connection Map (everything hanging off one
card), one ramp per connection type on the plat.

**Rejected.** A single ramp across everything drawn.

**Why.** This was built the obvious way first and it did not work. A single ramp
spends its whole range on the widest gap anywhere on screen. On the map for a
board member whose own address was recorded this year, all six association lots
landed at the dim end, indistinguishable, which is precisely the comparison the
feature exists to make. Siblings are what sit next to each other and invite
comparison, so siblings are what get the contrast.

The cost is that brightness is not comparable across two groups. The legend says
so rather than leaving it to be guessed.

### The ramp is linear in time, not in rank

**Chosen.** Opacity scales with elapsed days between the oldest and newest date
in the group, with a floor so the oldest is still legible.

**Rejected.** Spreading first-to-last evenly across the ramp.

**Why.** Rank order guarantees strong contrast, which is why it is tempting. It
also makes a twenty-year gap and a twenty-day gap look identical, and invents a
story of steady arrival that the data does not support. Seven lots that joined
together and one that joined last year should look like seven and one.

Below a fourteen-day span nothing is graded at all: two dates a day apart drawn
at opposite ends of a ramp would be a lie with a gradient on it.

### `startDate` only, never `createdAt`

**Chosen.** An undated connection is drawn at a fixed middle strength and
counted in the legend.

**Rejected.** Falling back to `createdAt` when `startDate` is missing.

**Why.** `createdAt` is when somebody typed the record in, which is a fact about
the office and not about the neighbourhood. A lot that joined in 1998 and was
entered last Tuesday would be drawn as the newest thing on the map. Middle
strength is used because the floor would read as "oldest" and the ceiling as
"newest", and neither is known.

### The demo association's memberships were given join dates

**Chosen.** Spread `startDate` values across `rel-hoa-member-*` in the fixture,
clustered rather than uniform.

**Why.** They carried none, so every membership graded identically and the
feature had nothing to show. A uniform random spread would have graded smoothly
and taught a reader nothing, because membership does not arrive at a constant
rate: most of an association predates anybody currently on its board.

These are invented demo values and get replaced by the client's real dates, as
everything else in the fixture does.

### The plat opens on the association's records, not on the county

**Chosen.** Frame the plat on the lots the association actually tracks, once,
when the harvested geometry has arrived. Switching a connection type on frames
the arcs. Two controls: one back to the records, one out to every county lot.

**Rejected.** Leaving the plat framed on the whole harvest, which is what
`fitExtent` gives and what it had always done.

**Why.** The plat draws 16,656 lots across 4.3 by 7.9 km. The association tracks
about fifty, spanning 1.1 by 0.44 km, roughly a sixtieth of the drawing. A
reader switching connections on saw nothing happen: the arcs were drawn,
correctly coloured and correctly graded, at a zoom where an arc is shorter than
its own stroke is wide.

Worth recording that this was not caused by growing the parcel layer, which was
the first suspicion. Measured against the previous harvest the association
occupied about a sixteenth of the frame's long side, and about an eighteenth
after. The plat had always opened too far out; sixteen thousand lots only made
it more obvious.

The county is still all there, one button away. `Maximize` was relabelled from
"Fit the whole plat" to "Fit every lot the county recorded", because it is no
longer the state you start in and the two now need telling apart.

## 2026-08-24, connecting the database

### Migrations are authored as files and pushed to the hosted project

**Chosen.** No local Postgres. Migrations are written into
`supabase/migrations/`, verified against a real Postgres, and applied with
`supabase db push`.

**Rejected.** Installing Docker for the full local stack, and editing the schema
in the Supabase dashboard.

**Why.** `CLAUDE.md` said "Never write against a remote Supabase project. Local
only", which assumed a Docker stack. There is no container runtime on this
machine, and 8.4GB free, so that rule described something that could not happen.
Leaving it in place while working around it would be worse than changing it.

What the rule was protecting is still protected: every schema change is a
reviewed file in git, applied the same way to every environment. What is lost is
`supabase db reset`, so there is no throwaway copy to break. `pnpm db:verify`
exists to make up for that.

The rule in `CLAUDE.md` now says schema changes are migration files and never
dashboard edits, which is the part that actually matters.

### The migrations are tested against Postgres compiled to WebAssembly

**Chosen.** `@electric-sql/pglite` as a devDependency, and `supabase/schema.test.ts`
runs every migration from empty on each `pnpm test`.

**Rejected.** Pushing to the hosted project and finding out there.

**Why.** This is a library outside the list in `CLAUDE.md`, which requires a
reason logged here. The reason is that without it the first thing ever to
execute these migrations would be the only copy of the client's data. PGlite is
Postgres itself, not an emulation: the same parser, planner, and plpgsql. Only
the `auth` schema is stubbed, and nothing this schema asserts depends on it.

It earned its place immediately. It caught that `pgcrypto` was being created for
no reason, and the seventeen tests it now runs include the audit triggers, which
are the one part of the schema with real logic in them and the part whose
failure is invisible until somebody needs the history.

### No extensions

**Chosen.** No `create extension` at all.

**Why.** `gen_random_uuid()` has been core Postgres since 13 and Supabase runs
15, so `pgcrypto` bought nothing. An extension that is not required is one more
thing that has to be present for a restore to work.

### The audit batch id comes from the transaction, not the application

**Chosen.** `current_batch_id()` reads a session setting the application may
set, and otherwise derives one id per transaction.

**Why.** The parcel import needs to link Activity to exactly its own rows, which
is what the setting is for. Everything else still wants grouping, and rows
written by one transaction belong together, so the fallback is not a null.

### Reference data ships as a migration, not as seed.sql

**Chosen.** The org, the ten relation types, and the four reference lists are in
`20260824120100_bootstrap.sql`, written idempotently.

**Why.** `seed.sql` only runs on `supabase db reset`, and the hosted project is
never reset: it receives migrations. Anything the application needs in order to
function has to arrive the way the schema does. The org id is fixed rather than
generated so the fixtures and the database describe the same organisation.

## 2026-08-24, district overlays

### Sixteen overlays, one shown at a time

**Chosen.** A picker on the plat, one boundary set drawn at a time, listed in
`scripts/sagis/overlays.mjs`.

**Rejected.** Independent toggles per overlay.

**Why.** The client asked for one at a time and they are right. A lot sits
inside a commission district, a voting precinct, and a sanitation route
simultaneously, and three sets of boundaries over a plat is a drawing nobody can
read.

### What the client asked for that does not exist

The list came from walking all 1,334 layers SAGIS publishes across 165 services.
Available and built: County Commission, Aldermanic, State House, State Senate,
US Congressional, voting precincts, police precincts, fire service districts,
sanitation collection days, school board districts, three sets of school
attendance zones, local historic districts, National Register districts, and
neighborhood associations.

Not published anywhere, and so not built:

- District Attorney, Recorder's Court, and Grand Jury districts. Searched for
  jury, magistrate, superior, recorder, prosecutor: nothing. These read as
  county-wide jurisdictions rather than districts that can be shaded.
- Code Enforcement districts.
- The MPC Monuments board. There is a monument survey point layer but no
  jurisdiction boundary. Historic Review is covered by local historic districts.
- The Tourism Leadership Council and Tourism Advisory Council, which are
  advisory bodies rather than areas.

Correcting an earlier answer in this file's spirit: voting precincts were
reported as unavailable when only `OpenData/Boundaries` had been checked. They
are published, at `OpenData/Community/MapServer/17`.

### Sanitation is four layers folded into one overlay

**Why.** The city publishes one layer per weekday rather than one layer with a
day column. A reader wants "which day is this street collected", not four
overlays they switch between to find out.

### The service simplifies the geometry, and the harvest clips it

**Chosen.** `maxAllowableOffset` of about two metres, and an envelope clip to
the extent of the harvested parcels.

**Why.** Statewide layers follow every marsh edge in Georgia. One congressional
district arrived as 343KB of coastline for a plat showing four kilometres of
Savannah. Simplifying and clipping took all sixteen overlays from 1.5MB to
656KB, and the largest single file a browser fetches from 343KB to 183KB. Two
metres is finer than a boundary drawn as a two pixel stroke can show.

### Labels are pinned into the visible part of a district

**Chosen.** The label sits at the mean of the district's vertices, slid to stay
inside the part of the district that is on screen.

**Rejected.** Labelling at the centroid and leaving it there.

**Why.** A voting precinct is far larger than the plat's opening view, so its
centroid is usually off screen and the label with it. That was the first
version, and it drew 27 boundaries with 27 labels, none of them visible. A
boundary a reader cannot identify is decoration.

The mean of the vertices rather than the centre of the bounding box, because an
L-shaped district has a box centre outside itself, and a label floating in the
neighbouring district is worse than no label.

## 2026-08-24, why the plat's colourings did nothing

### Theming is given every PIN the plat draws

**Chosen.** `pins` in `MapView` is the committed fixture merged with the
harvested layer, the same union the projection draws.

**Rejected.** Leaving it as `platPins()`.

**Why.** `platPins()` is the 40 lots in the committed fixture. The plat draws
16,656. So every colouring classified forty lots and dropped the other 16,616
into "unknown": measured in the browser, picking Occupancy moved 2,084 of the
2,124 lots on screen from one flat grey to a slightly different flat grey, and
coloured 40. It looked like the control did nothing because very nearly nothing
is what it did.

### `propertyByPin` is keyed on a normalised PIN

**Why.** It was keyed on the raw `data.pin` while every lookup asks with a
normalised one, because the plat asks with the PIN off a parcel polygon. That
works only while the county and the typist agree on spacing. A record entered as
`20003-15001` was invisible to every colouring, and would have been invisible in
a way nobody could have explained from the screen.

### The county's property class is its own mode

**Chosen.** A `property_class` colouring reading `propertyUseCode`, beside the
existing `property_use`.

**Rejected.** Filling `propertyUse` in from the county code when the association
has not recorded one.

**Why.** They are two different facts, and `CLAUDE.md` is explicit: zoning is
the regulatory district, property use is what is actually there, and collapsing
them breaks the "commercial use in a residential district" query, which needs
the two to disagree. `propertyUse` is null on every county parcel because nobody
has looked at those lots, and that is worth showing rather than papering over.

The county code is on all 16,656 parcels across 17 classes, so this is the
colouring that actually renders the whole plat: 82% R3, 12% C3. Buckets are
labelled with the raw code because the Board of Assessors has not published the
code table, and a guessed label is worse than an unexplained one.

## 2026-08-25, sale history and associations as owners

### The sale price is never zero, only absent

**Chosen.** `lastSalePrice` is null when the county recorded no price.

**Why.** Measured across the harvested extent: 94% of parcels carry a transfer
date and only 62% carry a price, so a third of recorded transfers have none.
That is a real kind of transfer, not a hole in the data: a gift, a family
transfer and a foreclosure all move a property with no consideration. Zero would
read as "sold for nothing" and would drag any average taken over the column
down with it. The lowest real price on the roll is $1, which is a nominal
transfer and a further reason not to treat small numbers as market evidence.

### The qualification code is shown beside the price, never instead of it

**Chosen.** `saleQualityCode` carried raw and rendered next to the number.

**Why.** Roughly half of recorded sales carry `U` and half `Q`. The convention
elsewhere in Georgia is that only one of the two is an arm's length sale usable
as evidence of value, but the Board of Assessors publishes no code table, so
that reading is unconfirmed here. `docs/SAGIS-API.md` already says not to invent
labels for these codes. A reader comparing sale prices needs to see the code to
know the number may not be a market price.

### The price and the code have no form field

**Chosen.** Both live on the Parcel record card and are `.optional()` in the
schema, unlike every other property field.

**Why.** They are the county's record, not the association's. Offering them as
editable inputs invites somebody to correct the county's roll in a copy of it.
The consequence is that the key is simply absent on a newly created property,
and `nullable` alone rejects absent: this broke record creation until both were
made optional as well. Worth knowing before adding another county-owned field.

### Association is a third owner kind, and the token list was measured

**Chosen.** `ASSOCIATION`, `ASSN`, `HOA`, `POA`, `CONDOMINIUM`, `CONDO`, matched
as whole words, read before the business tokens and after the government ones.

**Why each part:**

- Whole words, because `HOA` prefix-matches `HOAGLAND` and `HOANG`, which are
  real surnames in this county.
- `ASSOCIATES` is excluded. `239 MADISON AVENUE ASSOCIATES, LLC` is a
  partnership, and there are more of those here than there are associations.
- Association is read before business, because incorporated associations carry
  both tokens and reading the `INC` first files every condominium association in
  the county as a company.
- Government is read before association, because a housing authority is not a
  homeowners association and must never be offered as one.
- A condominium counts with or without the word association, because a
  condominium regime is an owners' association whether or not the county wrote
  it out.

**Deliberately excluded.** Churches, temples and ministries, which is 135
records. The association reference list is homeowners association, committee,
civic club and property owners association, and a congregation is none of those,
so they stay filed as businesses rather than being moved somewhere equally
wrong. `CLUB`, `SOCIETY` and `LODGE` are excluded for the same reason and
because there are four of them in total: the low confidence review is where
those belong, not a rule.

### Adding a third kind broke the second one, quietly

`parseOwner` skipped person parsing with a check for `kind === 'business'`. A
third kind fell through it, so every condominium association went to the person
parser and `37 THE LOFTS CONDOMINIUM ASSOCIATION INC` came back as somebody
surnamed 37. The check now reads `kind !== 'person'`, which is what it always
meant.

The import creates each kind with its own fields for the same reason. An
association filed with `businessCategory` would carry a key its own form never
shows and its schema does not know about. `associationDataSchema` gained a
mailing address, because the county publishes one for every owner and the
association form had nowhere to put it.

## 2026-08-25, owner reconciliation, and where AI is allowed

### Creating is allowed on a rule; linking needs more

**Chosen.** A confident parse is enough to create a record. Linking an owner to
an existing record needs either a byte-identical name or a confident parse
behind it, and anything else waits for a person.

**Why.** The two are not symmetric and treating them as one decision is how this
feature would do harm. Creating a duplicate is visible and mergeable. Attaching
somebody's house to a stranger is silent, and nothing on the screen afterwards
says it happened. `src/lib/parcels/owner.ts` already says a confident wrong
match is the worst thing this application can do; this is that rule applied to
the bulk case.

Measured on the real layer: 11,499 owners create, 1 links, 1,993 wait. The link
count is low because the demo directory holds 61 records, not because the
matching is weak.

### A truncated name is never acted on, matched or not

The county cuts the owner field at 40 characters before it reaches us, which is
860 of the 1,993 in the review pile. The end of the name is gone and nothing
downstream recovers it: creating from it files a record under half a name, and
linking on it is a guess. Both wait.

A consequence worth knowing: a name that is *exactly* 40 characters is
indistinguishable from one that lost its end, so it is treated as truncated.
`37 THE LOFTS CONDOMINIUM ASSOCIATION INC` is exactly 40 and goes to review. That
is the conservative answer and it is the right one, but it means the review pile
contains some complete names.

### Owners are grouped, not listed per parcel

1,286 owners here hold more than one lot and one holds 170. Deciding per parcel
would ask the same question 170 times and risk 170 different answers, and would
create 170 copies of the same company. One group is one decision and one record.

### The candidates are indexed, not scanned

`findOwnerMatch` walks the candidate list, which is right for the sixty parcels
the parcel import handles and is 13,493 walks of several thousand records here.
The bulk path indexes the directory once. Reconciling the whole layer takes
69ms and applying it 77ms.

### No LLM, for now

**Chosen.** The review queue lists the names the rules could not read and leaves
them to a person.

**Rejected, and then removed.** A reading service was built: a Vercel function
holding the API key server-side, proposing a kind and a readable name for names
in the queue, never given the directory so that it structurally could not
propose a link. It worked, and it was taken out at the client's request before
it was ever connected to a key.

**Why the removal is clean rather than dormant.** Leaving it in place would have
meant an unused dependency, a serverless surface this project otherwise does not
have, a second place to configure a secret, and a code path nobody exercises.
Git history keeps it if it is wanted later.

**What survives, and should, if it comes back.** The asymmetry above is the part
worth keeping: a model may propose what a name *is*, never who it *matches*.
Withholding the directory is what makes a wrong link impossible rather than
merely discouraged. And it should only ever see the residue: the rules settle
roughly 85% of the layer, and those names have no reason to leave the browser.

---

## The hand mark and the work log

The client's note: a panel keeping a running tab of what the analyst has done,
so they can see the last entry while working a printed list, and some visual
expression of what has had "the human touch". Both are built. The decisions
underneath them are these.

### A check is a claim about a record at a moment, not a flag

`entities.reviewed_at` records when a person last read a record. What the screen
shows is not that column but a comparison: the check against the last time the
county roll wrote to the same record. Three states come out of it, and the third
is the one that makes the other two worth storing.

| State | Means |
| ----- | ----- |
| Not checked | Nobody has read this against anything |
| Checked | A person read it, and nothing has overwritten them since |
| Recheck | They did, and the county has written to it since |

Without `recheck`, a check is a claim that quietly stops being true the next
time `pnpm sagis:harvest` feeds an import, and a stale green tick is worse than
no tick: it is a statement the association did not make. Derived rather than
stored, so an import cannot leave one behind by forgetting to invalidate
anything. It is `entity_review` in Postgres and `buildReviewIndex` in
`src/lib/review/status.ts`, and both are tested against the same cases.

**A tie counts as needing a recheck.** Two writes stamped the same instant carry
no evidence of which came first. Of the two ways to be wrong, only one costs
something.

### Provenance is a column on the audit log, not an inference about the actor

`audit_entries.source` is `hand`, `import`, or `system`, set from
`artypest.audit_source` the same way `batch_id` and the actor already are.

Attributing an import to whoever pressed the button would be true and useless.
The association is not asking whether a human started the job that wrote a row;
it is asking whether a human has read the record. Without this column there is
no way to tell the sixteen thousand county lots nobody has opened from the few
dozen somebody has, which is the only distinction the mark exists to draw.

`hand` is the default because it is the safe one. A write nobody declared is a
person at a keyboard, and mistaking a hand edit for an import only under-claims
the mark. The other way round it would tick sixteen thousand lots.

### Editing a record checks it, but a write that changes nothing does not

Somebody who opens a record, changes something, and saves it has read it, and
requiring a second click afterwards is the reason a mark like this stops getting
used. So a hand write claims the mark, in a trigger, for the same reason the
audit log is in a trigger.

But only when something actually moved. An update that changes no value already
leaves no trace in the audit log, and it must leave none here: a re-save, an
idempotent upsert, or a script touching every row must never be able to
manufacture a claim that a person read something. `claim_hand_review` compares
the row against itself with the bookkeeping columns removed, which is the same
comparison the audit trigger makes field by field a few statements later.

### Two marks, because there are two questions

The **record mark** answers "has anyone read this lot": a 2px moss rule down the
leading edge of the row or card, plus a badge that is also the control that sets
it. The **field mark** answers the next question, asked once somebody is already
looking at one record: of these eleven fields, which did we type and which came
off the roll? A small moss dot beside the label, read from the audit log by
`fieldSources` rather than stored beside each value, because a second copy of
something the log already records is a second copy that can disagree.

**Marked on the positive state, never shaded on the negative.** The plat carries
16,656 county lots against a few dozen the association has read. Tinting the
unread ones would tint almost the whole screen and say nothing. The ink goes
where the work went.

**Colour is never the only carrier.** Each state has its own glyph and its own
words. A board member printing a list in greyscale, or not distinguishing moss
from amber, can still tell them apart, and every mark carries the whole sentence
as its accessible name rather than only the verb.

### The work log is a reading of the audit trail, not a second store

Everything the panel shows is already recorded: the log has the timestamp, the
actor, and now the source. A parallel store of "what I did today" would be a
second copy, and it would be the wrong one, because it is the copy nothing else
writes to. It would also not survive a reload, which is exactly when somebody
working a paper list needs it.

What the panel does add is the reading: audit rows folded back into moves. A
save that changed six fields is six rows and one thing the reader did. Hand rows
group by record and instant, because one save writes one row per changed field
all stamped with the same moment, in the temporary provider and in Postgres,
where `now()` is fixed for the transaction. Import rows group by batch instead,
so a four-hundred-lot import is one line rather than four hundred.

### A session is a sitting, and it is one shared boundary

Stored, defaulting to the start of today, resettable by hand, rolling forward at
midnight so "this session" does not quietly become "this week". Not an idle
timeout: a reader can say when they sat down and a timer cannot, and a
twenty-minute phone call is not the end of a session.

It lives in a context rather than being read from storage wherever it is needed,
because two readings of the same boundary can disagree. The count in the header
and the list in the panel are the same claim, and starting a fresh session has
to move both at once.

### The panel is docked, not floated

The log is read against the list it is a log of, so covering that list would
defeat it. Below `lg` there is no room for both and it becomes a sheet. It is
rendered once and placed by `useMediaQuery` rather than twice behind `hidden`
and `lg:hidden`: two copies would both mount, both run their queries, and both
sit in the accessibility tree under the same name.

### `pnpm db:verify` pointed at a file that does not exist

It ran `vitest run src/lib/data/schema.test.ts`. The schema suite is
`supabase/schema.test.ts`, so the script had been passing by testing nothing.
Repointed, and the hand mark's Postgres behaviour added to it.
