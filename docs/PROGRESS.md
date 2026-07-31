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
