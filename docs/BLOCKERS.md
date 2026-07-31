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

**What was done instead.** Everything derivable from `CLAUDE.md` was built: the
stack, the directory layout, the entity type list, and the vocabulary. Where the
build plan was needed, placeholders were used and marked:

- `src/lib/data/fixtures.ts` carries ten provisional relation types
- `src/lib/validation/` is empty, since the per-type field lists are unknown
- `supabase/seed.sql` is a comment block, not seed data

**To unblock.** Add `docs/BUILD-PLAN.md`, then replace the placeholders above.

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
