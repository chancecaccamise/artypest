import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { RoleProvider } from '@/lib/role'
import { ThemeProvider } from '@/lib/theme'

/*
  Renders a component inside the same providers main.tsx uses, on a memory
  router so a test can start on any route.

  Each call gets a fresh QueryClient with retries off, so a failing query
  surfaces immediately instead of being retried into a timeout.
*/

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: RenderWithProvidersOptions = {}
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
          <RoleProvider>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </RoleProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient }
}
