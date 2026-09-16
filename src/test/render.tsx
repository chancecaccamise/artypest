import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { WorkSessionProvider } from '@/features/review/session'
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
