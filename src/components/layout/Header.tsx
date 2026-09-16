import { ClipboardList, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useActivity, useActor, useOrg } from '@/hooks/use-data'
import { useWorkSession } from '@/features/review/session'
import { buildWorkLog, recordCount, recordsChecked } from '@/features/review/work-log'
import { useAuth } from '@/lib/auth'
import { THEMES, useTheme, type Theme } from '@/lib/theme'
import { SearchBar } from './SearchBar'

const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

export interface HeaderProps {
  onOpenNav: () => void
  workLogOpen: boolean
  onToggleWorkLog: () => void
}

export function Header({ onOpenNav, workLogOpen, onToggleWorkLog }: HeaderProps) {
  const org = useOrg()
  const { theme, setTheme } = useTheme()
  const auth = useAuth()
  const sessionCount = useSessionCount()

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

      {/* Truncates rather than pushing the header controls off a 375px screen. */}
      <div className="min-w-0 flex-1 sm:flex-none">
        <p className="font-display text-ink text-13 truncate font-bold sm:text-sm">
          {org.data?.name ?? 'Loading organization'}
        </p>
      </div>

      <SearchBar className="mx-auto hidden max-w-md flex-1 sm:block" />

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
        {/*
          The count is the reason this is a header control rather than a menu
          item: "eleven so far" is worth seeing without opening anything, and
          it is what makes somebody open it.
        */}
        <Button
          variant={workLogOpen ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleWorkLog}
          aria-pressed={workLogOpen}
          aria-label={
            sessionCount === 0
              ? 'Work log. Nothing recorded this session.'
              : `Work log. ${recordCount(sessionCount)} this session.`
          }
          title="Work log"
        >
          <ClipboardList />
          <span className="hidden font-mono sm:inline">{sessionCount}</span>
        </Button>

        <Button
          variant="secondary"
          size="icon-sm"
          onClick={cycleTheme}
          aria-label={`Theme: ${theme}. Change theme.`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon />
        </Button>

        {auth.status === 'signed-in' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void auth.signOut()}
            aria-label="Sign out"
            title={`Signed in as ${auth.account.name} (${auth.account.email})`}
          >
            <LogOut />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        ) : null}
      </div>
    </header>
  )
}

/*
  How many records this reader has been through since they sat down.

  Reads the same rows the panel does, through the same query key, so opening
  the log costs nothing and the badge can never disagree with the list it
  stands for.
*/
function useSessionCount(): number {
  const actor = useActor()
  const { since } = useWorkSession()
  const activity = useActivity({ actor: actor.data, since, pageSize: 500 })

  return recordsChecked(buildWorkLog(activity.data?.rows ?? []))
}
