import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'

import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Button } from '@/components/ui/button'

const COLLAPSE_KEY = 'artypest.sidebar-collapsed'

/*
  The shell. One scroll container for the page body, so the sidebar and header
  stay put while a 300-row table scrolls.

  Below the lg breakpoint the sidebar becomes a sheet, which is what makes the
  app usable at 375px.
*/
export function AppShell() {
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(COLLAPSE_KEY) === 'true'
  )
  const location = useLocation()

  /*
    The sheet remembers which route it was opened on. Navigating anywhere,
    including with the browser back button, makes it stale and therefore
    closed. Deriving this beats an effect that fires a second render on every
    single route change.
  */
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const sheetOpen = openedAt === location.pathname

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, String(collapsed))
  }, [collapsed])

  // A route change returns the reader to the top of the page.
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (!sheetOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedAt(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sheetOpen])

  return (
    <div className="bg-paper flex h-svh overflow-hidden">
      <a
        href="#main"
        className="bg-paper-raised text-ink border-rule sr-only rounded-[3px] border px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>

      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
      </div>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="bg-ink/40 absolute inset-0"
            onClick={() => setOpenedAt(null)}
            aria-hidden="true"
          />
          <div className="panel-enter relative">
            <Sidebar
              collapsed={false}
              variant="sheet"
              onToggleCollapsed={() => undefined}
              onNavigate={() => setOpenedAt(null)}
            />
          </div>
          <Button
            variant="secondary"
            size="icon-sm"
            className="relative m-2"
            onClick={() => setOpenedAt(null)}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenNav={() => setOpenedAt(location.pathname)} />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto w-full max-w-[100rem] px-3 py-4 sm:px-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
