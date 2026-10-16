import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { WorkSessionProvider } from '@/features/review/session'
import { data, disconnectSharedRecords, setRemoteForTests } from '@/lib/data'
import { createFakeRemote } from '@/test/fake-remote'
import { AuthProvider } from '@/lib/auth'
import { RoleProvider } from '@/lib/role'
import { ThemeProvider } from '@/lib/theme'
import type { Database } from '@/types/database'

/*
  Renders a component inside the same providers main.tsx uses, on a memory
  router so a test can start on any route.

  Each call gets a fresh QueryClient with retries off, so a failing query
  surfaces immediately instead of being retried into a timeout.

  There is no database by default, whatever the environment says, so a test
  never reaches a real project and runs the demo with no sign-in. Sign-in tests
  pass a client backed by a fake network instead; see src/test/fake-supabase.ts.
*/

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  auth?: {
    client?: SupabaseClient<Database> | null
    requireSignIn?: boolean
  }
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', auth = {}, ...options }: RenderWithProvidersOptions = {}
): RenderResult & { queryClient: QueryClient } {
  /*
    Signed in means the shared records. In a test they are kept in memory by
    the same fake SyncedProvider is tested against, holding the association's
    own kinds of connection and nothing else, as a new database would.
  */
  // Whatever an earlier test signed in to is not this test's.
  disconnectSharedRecords()
  setRemoteForTests(
    auth.client
      ? (_client, orgId) =>
          createFakeRemote({
            org: { id: orgId, name: 'Ardsley Park Homeowners Association', sagisUrlTemplate: null, createdAt: '2026-01-01T00:00:00.000Z' },
            relationTypes: data.snapshot().relationTypes.map((type) => ({ ...type, orgId })),
          })
      : null
  )

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider client={auth.client ?? null} requireSignIn={auth.requireSignIn ?? false}>
            <RoleProvider>
              <WorkSessionProvider>
                <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
              </WorkSessionProvider>
            </RoleProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient }
}
