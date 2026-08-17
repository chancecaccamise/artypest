import { Menu, Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { useOrg } from '@/hooks/use-data'
import { ROLES, ROLE_LABELS, useRole } from '@/lib/role'
import { THEMES, useTheme, type Theme } from '@/lib/theme'
import { SearchBar } from './SearchBar'

const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const org = useOrg()
  const { theme, setTheme } = useTheme()
  const { role, setRole } = useRole()

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

      <SearchBar className="mx-auto hidden max-w-md flex-1 sm:block" />

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
