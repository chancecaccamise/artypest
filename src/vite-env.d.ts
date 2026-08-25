/// <reference types="vite/client" />

/*
  Every variable the app reads is declared here, so reading one is typed rather
  than an `any` escape hatch. Keep this and .env.example in step.
*/
interface ImportMetaEnv {
  readonly MODE: string
  /**
   * The Supabase project URL. Absent means no database, which is a working
   * state: the app falls back to the in-memory demo data.
   */
  readonly VITE_SUPABASE_URL?: string
  /**
   * The anon, or publishable, key. Safe in a browser because row level security
   * is on for every table. The service role key bypasses RLS and must never be
   * put here: anything with a VITE_ prefix is compiled into the public bundle.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * `true` reads live county parcel data and uses the county address locator.
   * Anything else, including absent, uses the committed sample so the app runs
   * with no network. There is no credential either way: SAGIS is public.
   */
  readonly VITE_SAGIS_LIVE?: string
  /** Only needed if the county replatforms its GIS. */
  readonly VITE_SAGIS_BASE_URL?: string
  /**
   * `1` runs the live SAGIS smoke test, which is the only test here that uses
   * the network. Left unset so `pnpm verify` stays offline.
   */
  readonly VITE_SAGIS_SMOKE?: string
}
