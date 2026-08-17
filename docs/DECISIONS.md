# Decisions

Assumptions made without the user present. Each entry states what was chosen,
what was rejected, and why.

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
