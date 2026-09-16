import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type PostgrestError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { getSupabase } from '@/lib/supabase'
import { setActiveActor } from '@/lib/data/actor'
import type { Database } from '@/types/database'

/*
  Who is signed in, and whether they may be.

  Accounts are created by an administrator in Supabase, never by signing up
  here. A correct password is not the whole answer, though: row level security
  decides what anyone can read through `org_users`, so an account with no row
  there would sign in to an application that can show it nothing. That is
  treated as its own state and said plainly, rather than let through.

  With no database configured the app keeps running on the in-memory demo,
  which is how the test suite and every fresh clone work. A production build is
  the exception: a deployment that lost its environment variables must refuse
  to open, not quietly open to everyone.
*/

export interface Account {
  userId: string
  email: string
  name: string
  /** As stored. Checked against the known roles by the role provider. */
  role: string
  orgId: string
}

export type AuthState =
  /** No database and not a production build: the demo, with no sign-in. */
  | { status: 'demo' }
  /** Sign-in is required and there is no database to sign in against. */
  | { status: 'unavailable' }
  /** Reading a saved sign-in from the browser. */
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Signed in, looking up whether the account belongs to the association. */
  | { status: 'checking'; email: string }
  | { status: 'no-access'; email: string }
  | { status: 'check-failed'; email: string; message: string; retrying: boolean }
  | { status: 'signed-in'; account: Account }

interface AuthActions {
  /** Resolves to a board-readable reason when it fails, or null. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** Repeats the membership lookup after `check-failed`. */
  retryCheck: () => void
}

export type AuthContextValue = AuthState & AuthActions

const AuthContext = createContext<AuthContextValue | null>(null)

export interface AuthProviderProps {
  children: ReactNode
  /** Defaults to the configured client. Null means no database. */
  client?: SupabaseClient<Database> | null
  /** Defaults to production builds. Only ever overridden by tests. */
  requireSignIn?: boolean
}

export function AuthProvider({
  children,
  client = getSupabase(),
  requireSignIn = import.meta.env.PROD,
}: AuthProviderProps) {
  const queryClient = useQueryClient()

  /* Undefined until the client has read whatever sign-in the browser saved. */
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!client) return

    /*
      The first event is INITIAL_SESSION, so this one subscription covers both
      restoring a saved sign-in and every change after it. Supabase warns that
      awaiting another client call inside this callback can deadlock, which is
      why the membership lookup is a query keyed on the user rather than
      something started from here.
    */
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => data.subscription.unsubscribe()
  }, [client])

  const userId = session?.user.id ?? null

  const membership = useQuery({
    queryKey: ['auth', 'membership', userId],
    queryFn: () => (client && userId ? fetchAccount(client, userId) : null),
    enabled: client !== null && userId !== null,
    // Read once per sign-in. Row level security still decides every read after.
    staleTime: Infinity,
  })

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (!client) return 'Sign-in is not available on this site.'
      try {
        const { error } = await client.auth.signInWithPassword({ email, password })
        return error ? describeSignInError(error) : null
      } catch (error) {
        return describeSignInError(error)
      }
    },
    [client]
  )

  const signOut = useCallback(async () => {
    if (!client) return
    /*
      Local scope signs out this browser only. The default would also end the
      same person's sign-in on their phone, which is not what "sign out" means
      to anybody. The saved sign-in is removed even if the network call fails.
    */
    await client.auth.signOut({ scope: 'local' })
    // Nothing read under one account is left in memory for the next.
    queryClient.clear()
  }, [client, queryClient])

  const { isPending, isError, isFetching, error, data: account, refetch } = membership
  const retryCheck = useCallback(() => void refetch(), [refetch])
  const hasClient = client !== null

  /*
    Keep the temporary local provider's audit actor aligned with the account.
    The eventual Supabase provider gets this from auth.jwt() in Postgres, but
    local writes need the same identity now for the work log to find them.
  */
  useEffect(() => {
    setActiveActor(account?.email)
    return () => setActiveActor(null)
  }, [account?.email])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...deriveState({
        hasClient,
        requireSignIn,
        session,
        membership: { isPending, isError, isFetching, error, account },
      }),
      signIn,
      signOut,
      retryCheck,
    }),
    [
      hasClient,
      requireSignIn,
      session,
      isPending,
      isError,
      isFetching,
      error,
      account,
      signIn,
      signOut,
      retryCheck,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}

/* ---------------------------------------------------------------- state -- */

interface DeriveInput {
  hasClient: boolean
  requireSignIn: boolean
  session: Session | null | undefined
  membership: {
    isPending: boolean
    isError: boolean
    isFetching: boolean
    error: Error | null
    account: Account | null | undefined
  }
}

function deriveState({ hasClient, requireSignIn, session, membership }: DeriveInput): AuthState {
  if (!hasClient) return requireSignIn ? { status: 'unavailable' } : { status: 'demo' }
  if (session === undefined) return { status: 'loading' }
  if (session === null) return { status: 'signed-out' }

  const email = session.user.email ?? ''

  if (membership.isError) {
    return {
      status: 'check-failed',
      email,
      message: membership.error?.message ?? 'Could not check your account.',
      retrying: membership.isFetching,
    }
  }
  if (membership.isPending || membership.account === undefined) {
    return { status: 'checking', email }
  }
  if (membership.account === null) return { status: 'no-access', email }

  return { status: 'signed-in', account: membership.account }
}

/* ---------------------------------------------------------------- reads -- */

/**
 * The signed-in user's place in the association, or null when they have none.
 *
 * Row level security only returns `org_users` rows for orgs the caller belongs
 * to, so no row here is a real answer rather than a permissions failure.
 */
async function fetchAccount(
  client: SupabaseClient<Database>,
  userId: string
): Promise<Account | null> {
  const { data, error } = await client
    .from('org_users')
    .select('org_id, name, email, role')
    .eq('user_id', userId)
    // One association per sitting until there is a way to choose between them.
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw new Error(describeAccountCheckError(error))

  const row = data[0]
  if (!row) return null

  return { userId, email: row.email, name: row.name, role: row.role, orgId: row.org_id }
}

/* ------------------------------------------------------------- messages -- */

/*
  Written for the person at the sign-in form, who cannot see the console and
  should not need to.
*/
function describeSignInError(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return 'Could not reach the sign-in service. Check the internet connection and try again.'
  }

  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'That email address and password do not match an account. Check both and try again.'
      case 'email_not_confirmed':
        return 'This account has not been confirmed yet. Ask your administrator to confirm it.'
      case 'user_banned':
        return 'This account has been suspended. Ask your administrator.'
      case 'over_request_rate_limit':
        return 'Too many sign-in attempts. Wait a few minutes, then try again.'
    }
    if (error.status === 429) {
      return 'Too many sign-in attempts. Wait a few minutes, then try again.'
    }
  }

  const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
  return `Sign-in did not work${detail}. Try again, and tell your administrator if it keeps happening.`
}

function describeAccountCheckError(error: PostgrestError): string {
  // Postgres says 42P01 for a missing table; PostgREST says PGRST205.
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return 'You are signed in, but the database has not been set up yet. Ask your administrator to finish setting it up.'
  }
  return 'Could not check your account. Check the internet connection and try again.'
}
