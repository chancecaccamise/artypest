# Decisions

Assumptions made without the user present. Each entry states what was chosen,
what was rejected, and why.

## 2026-07-31

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
