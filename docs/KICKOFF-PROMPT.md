# Kickoff Prompt

Paste everything below the line as your first message in Claude Code.

---

You are building Phase 1 of the HOA relationship management platform. `CLAUDE.md` and `docs/BUILD-PLAN.md` are in this repo. Read both fully before writing any code.

I am away and will not be available to answer questions. Work autonomously within the scope below. When you hit a decision I would normally make, choose the most conservative reasonable option, log it in `docs/DECISIONS.md`, and keep moving. Do not stop and wait for me.

## Scope: Phase 1 only

Build the foundation. Nothing else.

**In scope**

1. Project scaffold: Vite + React + TypeScript strict + Tailwind + shadcn/ui, ESLint, Prettier, Vitest, and the `pnpm verify` script from CLAUDE.md
2. Local Supabase via the CLI, running in Docker
3. Complete schema as migrations, in this order, one migration file per numbered item:
   - `orgs`, and the profiles/roles table linking auth users to orgs
   - `folders`, `tags`, `entity_tags`, `reference_data`
   - `entities`
   - `relation_types`, `relations`
   - `attachments`
   - `audit_log` plus the `fn_audit()` trigger function and triggers on `entities` and `relations`
   - `pg_trgm` extension, `search_vector` column, `fn_entity_search_vector()` trigger, and all indexes
   - RLS policies for every table above
4. `seed.sql` containing: one demo org, the ten relation types from the build plan, and reference data for zoning, property use, association type, and record type
5. Generated `src/types/database.ts`
6. Zod schema per entity type in `src/lib/validation/`, matching the `data` JSONB field lists in the build plan
7. Supabase client singleton, auth (email and password), protected routes, login and signup pages
8. App shell: sidebar nav, header with org name, breadcrumbs, dark and light theme toggle
9. Generic entity CRUD: list view with search and pagination, detail view, create and edit forms driven by the Zod schemas, soft delete and archive with restore. Must work for all seven entity types.
10. A History tab on the entity detail view rendering that record's `audit_log` rows as a readable field-level diff

**Explicitly out of scope.** Do not build these even if you finish early:

- The Connection Map or any graph visualization
- Relation create and edit UI (the tables must exist, the UI comes in Phase 2)
- Global search UI
- SAGIS integration, parcel import, or anything touching Mapbox
- Documents, records, or file upload UI
- The dashboard
- Conflict-of-interest detection
- Any deployment, hosting, or CI configuration

If you finish the in-scope list, write tests and improve what exists. Do not start Phase 2.

## How to work

1. First, read `CLAUDE.md` and `docs/BUILD-PLAN.md` in full.
2. Write `docs/PHASE-1-PLAN.md` breaking the scope above into ordered, individually committable tasks. Include your reasoning on anything the build plan left ambiguous.
3. Then execute it top to bottom.
4. After each task: run `pnpm verify`, then `supabase db reset` if you touched migrations. Both must pass before you commit.
5. Commit per completed task. Conventional commit format. Never commit with failing checks.
6. Append a dated entry to `docs/PROGRESS.md` after each task: what you did, what you verified, what is next.

## Decision rules while I am away

- **Ambiguous requirement:** pick the simpler interpretation, log it in `docs/DECISIONS.md` with the alternative you rejected and why.
- **Missing detail the build plan does not cover:** choose the convention that matches the rest of the codebase. Log it.
- **Something in the build plan looks wrong:** implement it as written, and add a note to `docs/BLOCKERS.md` explaining your concern. Do not silently deviate from the spec.
- **Genuinely blocked, cannot proceed:** write it up in `docs/BLOCKERS.md`, then skip that task and continue with the next one. Never stall.
- **Third-party service credentials needed:** stub the integration behind an interface, log it in `docs/BLOCKERS.md`, move on. Never invent a key or a URL.

## Hard constraints

- Never run `supabase link`, `supabase db push`, or anything else that touches a remote project. Local Docker only.
- Never commit `.env.local` or any real credential. Maintain `.env.example` with placeholders.
- Never `git push --force`, never rewrite published history, never `git reset --hard` on work that is already committed.
- Never hand-edit `src/types/database.ts`. Regenerate it.
- Never disable a lint rule or use `@ts-ignore` to make a check pass. Fix the underlying problem or log a blocker.
- Migrations are forward-only. To change something, write a new migration. Do not edit a migration that already ran.
- No em dashes anywhere, including comments and commit messages.

## Definition of done

I should be able to clone the repo, run `pnpm install && supabase start && supabase db reset && pnpm dev`, log in, and create, edit, archive, and restore a Person, a Property, a Business, and an Association. Every one of those actions should appear in that record's History tab with the specific fields that changed.

`pnpm verify` passes clean. `docs/DECISIONS.md`, `docs/PROGRESS.md`, and `docs/BLOCKERS.md` all tell me exactly what happened while I was gone.

Start by reading the two documents, then write `docs/PHASE-1-PLAN.md`.
