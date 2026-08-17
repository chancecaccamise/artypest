# Blockers

Anything that stopped work, and what was done instead.

## Open

### `docs/BUILD-PLAN.md` does not exist

**Impact.** High. This is the specification. `CLAUDE.md` imports it on line 5
via `@docs/BUILD-PLAN.md`, and the kickoff prompt refers to it for the schema,
the ten relation types, the `data` JSONB field list per entity type, and the
reference data for zoning, property use, association type, and record type.

It was not in the download alongside `CLAUDE.md`, `settings.json`, and
`KICKOFF-PROMPT.md`, and it is not anywhere on this machine.

**What was done instead.** Everything derivable from `CLAUDE.md` and
`UI-SPEC.md` was built, which turned out to be the whole user interface. Where
the build plan was needed, placeholders were used and marked:

- `src/lib/data/fixtures.ts` carries ten provisional relation types
- `src/features/directory/config.tsx` carries a provisional field list per
  entity type, and `src/lib/validation/entities.ts` carries the matching Zod
  schemas. Both were inferred from `UI-SPEC.md` and the domain, not from a
  specification
- `supabase/seed.sql` is a comment block, not seed data

**To unblock.** Add `docs/BUILD-PLAN.md`, then confirm or replace the relation
types and the per-type field lists. Both live in one file each, so correcting
them is a data change rather than a rewrite.

### The UI specification says not to build the Connection Map, and the user asked for it

**Impact.** Resolved by asking which instruction wins, and it is the user's.

`UI-SPEC.md` section 2 says the Connection Map "renders a designed empty state
explaining what it will do, not a broken component and not a fake graph. Do not
build the visualization." The user's message attached a reference screenshot of
the map and asked for that interface.

**What was done instead.** The map was built, against the real relation data,
matching the screenshot's structure. The dashboard's Connection Map card was
changed from a disabled "Arrives in Phase 3" button to a working link. See
`DECISIONS.md`.

**To unblock.** Nothing outstanding. Flagged here only so the departure from the
written specification is recorded rather than silently absorbed.

### `docs/MAP-SPEC.md` did not exist either

**Impact.** Was high, now unblocked by writing one.

`docs/PLAT-VIEW-SPEC.md` refers to it by section for the location resolution
cascade (section 1), split view linked selection (section 4), and the thematic
modes (section 5). None of the plat view could be built without those rules.

**What was done instead.** `docs/MAP-SPEC.md` was written from the domain,
`CLAUDE.md`, and the hints in the plat view specification, which names occupancy
and data completeness as the first two thematic modes. It carries a provenance
note at the top saying so.

Every rule in it names the single file that implements it:

- the cascade is `src/lib/locations/resolve.ts`
- thematic modes are `src/features/map/theming.ts`
- spatial queries are `src/features/map/spatial.ts`
- the geometry is `src/lib/geo/`

**To unblock.** Supply the real `docs/MAP-SPEC.md` and diff it against the
written one. Correcting a rule is an edit to one file, not a rewrite.

### `docs/PLAT-VIEW-SPEC.md` assumes a `d3-force` install that never happened

**Impact.** None. Recorded so the assumption is not carried forward.

The plat view specification introduces d3-geo and d3-zoom as being "in the same
family as the `d3-force` you are already installing for the Connection Map".
The Connection Map does not use d3-force: it uses a computed hierarchical
layout, deliberately, so that the same records produce the same picture twice.

**What was done instead.** d3-geo, d3-zoom, and d3-selection were installed on
their own merits and logged in `DECISIONS.md`. d3-force still is not installed.

### Docker is not installed

**Impact.** Medium, deferred. `supabase start` needs Docker, so the local
Postgres stack cannot run on this machine yet.

**What was done instead.** Not a blocker right now, because the app deliberately
runs on the in-memory provider. `supabase init` was run and `supabase/config.toml`
exists, so the directory is ready when Docker is.

**To unblock.** Install Docker Desktop, then `pnpm exec supabase start`.

### The Supabase CLI is a devDependency, not a global binary

**Impact.** Low, cosmetic. `CLAUDE.md` documents bare `supabase ...` commands.

**What was done instead.** Installed the `supabase` npm package as a
devDependency, since Homebrew is not on this machine. The documented commands
work with `pnpm exec` in front, and `pnpm db:reset` and `pnpm db:types` are
wired up in `package.json` as shortcuts.

## Resolved

Nothing yet.
