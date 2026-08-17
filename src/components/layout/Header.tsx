import { useEffect, useRef, useState } from 'react'
import { Menu, Monitor, Moon, Search, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { useOrg } from '@/hooks/use-data'
import { ROLES, ROLE_LABELS, useRole } from '@/lib/role'
import { THEMES, useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const org = useOrg()
  const { theme, setTheme } = useTheme()
  const { role, setRole } = useRole()

  const searchRef = useRef<HTMLInputElement>(null)
  const [searchFocused, setSearchFocused] = useState(false)

  // "/" focuses search, the convention this audience will already have from
  // everything else they use. It is deliberately not a hijack of "/" in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      event.preventDefault()
      searchRef.current?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const cycleTheme = () => {
    const index = THEMES.indexOf(theme)
    const next = THEMES[(index + 1) % THEMES.length] ?? 'system'
    setTheme(next)
  }

  const ThemeIcon = THEME_ICON[theme]

  return (
    <header className="bg-paper-raised border-rule flex h-14 shrink-0 items-center gap-3 border-b px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      {/* Truncates rather than pushing the role switcher off a 375px screen. */}
      <div className="min-w-0 flex-1 sm:flex-none">
        <p className="font-display text-ink truncate text-13 font-bold sm:text-sm">
          {org.data?.name ?? 'Loading organization'}
        </p>
      </div>

      {/* Search is a placeholder in this phase and says so rather than failing. */}
      <div className="relative mx-auto hidden max-w-md flex-1 sm:block">
        <Search
          className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search"
          aria-describedby="search-phase-note"
          placeholder="Search residents, lots, vendors"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className={cn(
            'border-rule bg-paper text-ink placeholder:text-ink-faint h-8 w-full rounded-[3px] border pr-10 pl-8 text-13',
            'transition-colors duration-[120ms] hover:border-rule-strong'
          )}
        />
        <kbd className="border-rule text-ink-faint pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[3px] border px-1 font-mono text-[0.6875rem]">
          /
        </kbd>
        <p
          id="search-phase-note"
          role="status"
          className={cn(
            'panel text-ink-muted absolute top-full right-0 left-0 z-40 mt-1 px-2 py-1.5 text-xs',
            searchFocused ? 'panel-enter block' : 'hidden'
          )}
        >
          Search arrives in Phase 2. Use the directory pages in the meantime.
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
        <label className="sr-only" htmlFor="role-switcher">
          Preview as role
        </label>
        <Select
          id="role-switcher"
          value={role}
          onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])}
          className="h-8 w-auto max-w-[9rem] min-w-0 text-13 sm:min-w-[8.5rem]"
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </Select>

        <Button
          variant="secondary"
          size="icon-sm"
          onClick={cycleTheme}
          aria-label={`Theme: ${theme}. Change theme.`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon />
        </Button>
      </div>
    </header>
  )
}
