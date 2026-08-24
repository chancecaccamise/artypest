import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import App from './App'
import { initializeData } from '@/lib/data'
import { loadParcelLayer } from '@/lib/parcels/parcel-layer'
import { RoleProvider } from '@/lib/role'
import { ThemeProvider } from '@/lib/theme'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found. Check index.html for <div id="root">.')
}

/** Narrowed once here, so the async start below does not need an assertion. */
const root = rootElement

/*
  The in-memory provider answers instantly and never goes stale on its own, so
  there is nothing to refetch on window focus. These defaults are worth
  revisiting when the Supabase provider lands.
*/
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/*
  The harvested parcel layer is fetched, not bundled, so it has to arrive before
  the first render: every lot becomes an entity, and a directory that grew from
  48 rows to 16,656 a second after painting would read as a bug.

  When the slice is absent, which is every fresh clone until `pnpm sagis:harvest`
  runs, this resolves to nothing and the app renders the committed demo instead
  of failing.
*/
async function start() {
  const layer = await loadParcelLayer()
  initializeData(layer.records, layer.source)

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RoleProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </RoleProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

void start()
