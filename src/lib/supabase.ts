import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/*
  The Supabase client, and the one place that decides whether there is one.

  The app has run on in-memory fixtures since it was built, behind the
  `DataProvider` seam in src/lib/data. That does not stop being true the moment
  a database exists: a missing or misconfigured URL has to leave the app working
  rather than white-screen it, because the demo, the test suite, and every fresh
  clone all run with no credentials at all.

  So this returns null when it is not configured, and callers treat null as
  "no backend yet" rather than as an error.
*/

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/*
  Only the anon key belongs here. It is designed to sit in a browser and is
  protected by row level security, which is why every table has it enabled from
  the migration that creates it.

  The service role key bypasses RLS entirely. It must never appear in a VITE_
  variable, because everything with that prefix is compiled into the JavaScript
  bundle and served to the public.
*/
function readConfig(): { url: string; anonKey: string } | null {
  const url = typeof PROJECT_URL === 'string' ? PROJECT_URL.trim() : ''
  const anonKey = typeof ANON_KEY === 'string' ? ANON_KEY.trim() : ''
  if (url === '' || anonKey === '') return null

  // A service key is a JWT with "service_role" in it. Refuse rather than ship it.
  if (anonKey.includes('service_role')) {
    console.error(
      'VITE_SUPABASE_ANON_KEY looks like a service role key. That key bypasses ' +
        'row level security and must never reach the browser. Refusing to start ' +
        'the client. Use the anon or publishable key instead.'
    )
    return null
  }

  return { url, anonKey }
}

/*
  Typed with the generated Database, so a column that does not exist is a
  compile error rather than a runtime empty result. Regenerate with
  `pnpm db:types` after every migration; never hand-edit src/types/database.ts.
*/
let client: SupabaseClient<Database> | null | undefined

/**
 * The client singleton, or null when no credentials are configured.
 *
 * Created lazily and cached, including the null, so a misconfigured
 * environment is not re-checked on every call.
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (client !== undefined) return client

  const config = readConfig()
  client =
    config === null
      ? null
      : createClient<Database>(config.url, config.anonKey, {
          auth: {
            // A board member should not be signed out by closing the tab.
            persistSession: true,
            autoRefreshToken: true,
          },
        })

  return client
}

/** True when the app has somewhere to talk to. */
export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null
}

export interface ConnectionCheck {
  ok: boolean
  /** Board-readable. Shown in Settings, not only logged. */
  detail: string
}

/**
 * Asks the database one cheap question, to prove the browser can reach it.
 *
 * Counts orgs rather than selecting rows: it needs no data to exist yet, and it
 * still exercises the URL, the key, and the RLS policy in one round trip. An
 * empty result with no error is a pass, because "connected, nothing readable
 * yet" is the expected state before anybody has signed in.
 */
export async function checkConnection(): Promise<ConnectionCheck> {
  const supabase = getSupabase()
  if (!supabase) {
    return {
      ok: false,
      detail:
        'No database configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
        'in .env.local, then restart the dev server.',
    }
  }

  const { count, error } = await supabase
    .from('orgs')
    .select('*', { count: 'exact', head: true })

  if (error) {
    /*
      The two failures worth telling apart. A missing table means the migrations
      have not been pushed; anything else is the connection or the key.
    */
    const missingTable = error.code === '42P01' || error.message.includes('does not exist')
    return {
      ok: false,
      detail: missingTable
        ? 'Connected, but the schema is not there yet. Run `pnpm db:push` to apply the migrations.'
        : `Could not read from the database: ${error.message}`,
    }
  }

  return {
    ok: true,
    detail:
      count === 0
        ? 'Connected. The schema is there and no organisation is readable yet, which is expected before sign-in.'
        : `Connected. ${String(count)} organisation${count === 1 ? '' : 's'} readable.`,
  }
}

/** Test seam. Drops the cached client so the next call re-reads the config. */
export function resetSupabaseClientForTests(): void {
  client = undefined
}
