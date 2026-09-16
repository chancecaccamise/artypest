import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/*
  A real Supabase client with a fake network behind it.

  Mocking the client's methods would test what we believe the library does.
  Answering its HTTP requests instead runs the library's own sign-in, error
  classes, session storage, and query builder, so a test fails when our reading
  of those is wrong, not only when our code is.

  Only the three endpoints sign-in uses are answered: the password grant,
  logout, and the `org_users` read. Anything else is a 404 that names itself.
*/

const PROJECT_URL = 'https://fake-project.supabase.co'
const STORAGE_KEY = 'artypest-test-auth'
const ORG_ID = '00000000-0000-4000-a000-000000000001'

export interface FakeAccount {
  id: string
  email: string
  password: string
  /** Their `org_users` row. Absent is an account nobody has given access to. */
  member?: { name: string; role: string }
  /** Defaults to true. False answers like an unconfirmed Supabase account. */
  confirmed?: boolean
}

export interface FakeSupabase {
  client: SupabaseClient<Database>
  /** Every request made, as "METHOD /path?query". */
  requests: string[]
  /** While true, every request fails the way a dropped connection does. */
  setOffline: (offline: boolean) => void
}

export interface FakeSupabaseOptions {
  accounts: FakeAccount[]
  /** Email of an account whose sign-in was saved by an earlier visit. */
  savedSignIn?: string
}

export function createFakeSupabase({ accounts, savedSignIn }: FakeSupabaseOptions): FakeSupabase {
  const requests: string[] = []
  let offline = false

  // Seeded before the client exists, because the client reads it as it starts.
  const stored = new Map<string, string>()
  if (savedSignIn !== undefined) {
    const account = accounts.find((candidate) => candidate.email === savedSignIn)
    if (!account) throw new Error(`No fake account for ${savedSignIn}`)
    stored.set(STORAGE_KEY, JSON.stringify(sessionFor(account)))
  }

  const fakeFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const method = (init?.method ?? 'GET').toUpperCase()
    requests.push(`${method} ${url.pathname}${url.search}`)

    if (offline) return Promise.reject(new TypeError('Failed to fetch'))

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        email?: string
        password?: string
      }
      const account = accounts.find((candidate) => candidate.email === body.email)
      if (!account || account.password !== body.password) {
        return Promise.resolve(authError(400, 'invalid_credentials', 'Invalid login credentials'))
      }
      if (account.confirmed === false) {
        return Promise.resolve(authError(400, 'email_not_confirmed', 'Email not confirmed'))
      }
      return Promise.resolve(json(200, sessionFor(account)))
    }

    if (url.pathname === '/auth/v1/logout') {
      return Promise.resolve(new Response(null, { status: 204 }))
    }

    if (url.pathname === '/rest/v1/org_users') {
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')
      const account = accounts.find((candidate) => candidate.id === userId)
      const rows = account?.member
        ? [
            {
              org_id: ORG_ID,
              name: account.member.name,
              email: account.email,
              role: account.member.role,
            },
          ]
        : []
      return Promise.resolve(json(200, rows))
    }

    return Promise.resolve(json(404, { message: `No fake for ${method} ${url.pathname}` }))
  }

  const client = createClient<Database>(PROJECT_URL, 'fake-anon-key', {
    auth: {
      storageKey: STORAGE_KEY,
      storage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
        removeItem: (key) => void stored.delete(key),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fakeFetch },
  })

  return {
    client,
    requests,
    setOffline: (next) => {
      offline = next
    },
  }
}

/* -------------------------------------------------------------- answers -- */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/* The current error shape, which carries a string code the client exposes. */
function authError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
  })
}

function sessionFor(account: FakeAccount) {
  const now = Math.floor(Date.now() / 1000)
  const expiresIn = 3600

  return {
    access_token: unsignedJwt({
      sub: account.id,
      email: account.email,
      aud: 'authenticated',
      role: 'authenticated',
      iat: now,
      exp: now + expiresIn,
    }),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: `refresh-${account.id}`,
    user: {
      id: account.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: account.email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  }
}

/* Well formed, so anything that decodes it can. Nothing here verifies it. */
function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}
