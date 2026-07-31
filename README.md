# Artypest

Multi-tenant HOA relationship management. The core of the product is the
Connection Map: a graph showing how residents, properties, businesses, and
associations connect to each other.

See `CLAUDE.md` for the stack, the layout, and the rules. See `docs/` for the
specification, decisions, progress, and blockers.

## Getting started

```bash
pnpm install
pnpm dev
```

No `.env.local` is needed yet. The app runs entirely on an in-memory data
provider seeded with demo fixtures, so nothing external has to be running.

## Commands

```bash
pnpm dev            # vite dev server
pnpm build          # production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest run
pnpm verify         # typecheck && lint && test && build
```

`pnpm verify` must pass before any commit.

## Data layer

The app talks to a `DataProvider` (`src/lib/data/types.ts`), never to a database
client directly. `src/lib/data/index.ts` is the single place that picks an
implementation.

Right now that is the in-memory provider, because the Supabase stack is not set
up. It reproduces the two behaviours the Postgres schema will own, so UI written
against it will not need rewriting:

- archive (`archivedAt`) and soft delete (`deletedAt`) are separate states
- an update writes one audit row per changed field, so history reads as a
  field-level diff

Switching to Supabase means writing a second implementation of the same
interface and changing one line in `index.ts`.

## Supabase

The `supabase/` directory is initialised but dormant. Nothing runs it yet, and
Docker is not installed on this machine. The Supabase CLI is a devDependency, so
the documented commands need `pnpm exec`:

```bash
pnpm exec supabase start
pnpm db:reset       # supabase db reset
pnpm db:types       # regenerate src/types/database.ts
```

`src/types/database.ts` is generated. Never hand-edit it.
