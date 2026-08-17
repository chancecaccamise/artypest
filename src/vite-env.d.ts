/// <reference types="vite/client" />

/*
  Every variable the app reads is declared here, so reading one is typed rather
  than an `any` escape hatch. Keep this and .env.example in step.

  When Supabase is wired up, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
*/
interface ImportMetaEnv {
  readonly MODE: string
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
