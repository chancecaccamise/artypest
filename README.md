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

The database is hosted. Migrations live in `supabase/migrations/`, are checked
against Postgres with `pnpm db:verify`, and are applied with `pnpm db:push`.
Schema changes are never made in the dashboard. See `CLAUDE.md`.

```bash
pnpm db:link        # link this checkout to the hosted project
pnpm db:push        # apply pending migrations
pnpm db:types       # regenerate src/types/database.ts
```

`src/types/database.ts` is generated. Never hand-edit it.

## Staff sign-in

Setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`)
turns sign-in on. With neither set, development and tests run the demo with no
sign-in, and a production build refuses to open.

To give somebody access:

1. In the Supabase dashboard, Authentication, Users, add the user with an email
   and password, and tick "Auto Confirm User".
2. Add them to the association as an administrator in the SQL editor. Everyone
   admitted to the site has the same full access; there is no role selector in
   the application.

   ```sql
   insert into org_users (org_id, user_id, name, email, role)
   select '00000000-0000-4000-a000-000000000001', id, 'Their full name', email, 'manager'
   from auth.users
   where email = 'their.email@example.com';
   ```

An account that signs in without step 2 is told it has not been given access.
This is data, not schema, so the SQL editor is the right place for it.

Turn off "Allow new users to sign up" in Authentication settings: accounts are
only ever created by an administrator.
