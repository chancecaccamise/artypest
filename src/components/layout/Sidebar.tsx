import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { NAV_GROUPS } from './nav-config'
import { Button } from '@/components/ui/button'
import { useCounts } from '@/hooks/use-data'
import { cn } from '@/lib/utils'

export interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Set on the mobile sheet, where collapsing to icons makes no sense. */
  variant?: 'rail' | 'sheet'
  onNavigate?: () => void
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  variant = 'rail',
  onNavigate,
}: SidebarProps) {
  const counts = useCounts()
  const isSheet = variant === 'sheet'
  const showLabels = isSheet || !collapsed

  return (
    <nav
      aria-label="Main"
      className={cn(
        'bg-paper-raised border-rule flex h-full flex-col border-r',
        isSheet ? 'w-[17rem]' : collapsed ? 'w-14' : 'w-56'
      )}
    >
      <div
        className={cn(
          'border-rule flex h-14 shrink-0 items-center border-b px-2',
          showLabels ? 'justify-between' : 'justify-center'
        )}
      >
        {showLabels ? (
          <span className="font-display text-ink truncate pl-1.5 text-sm font-bold tracking-tight">
            Artypest
          </span>
        ) : null}
        {isSheet ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1 px-2">
            {showLabels ? (
              <p className="label-caps px-1.5 pt-2 pb-1 text-[0.6875rem]">{group.label}</p>
            ) : (
              // Collapsed, the group is still announced but drawn as a rule.
              <div className="border-rule mx-1 my-2 border-t" role="separator" aria-label={group.label} />
            )}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const count = item.countType ? counts.data?.[item.countType] : undefined

                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      title={showLabels ? undefined : item.label}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-[3px] px-1.5 py-1.5 text-13 transition-colors duration-[120ms]',
                          showLabels ? 'justify-start' : 'justify-center',
                          isActive
                            ? 'bg-paper-sunken text-ink font-semibold'
                            : 'text-ink-muted hover:bg-paper-sunken hover:text-ink'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn('size-4 shrink-0', isActive ? 'text-moss' : '')}
                            aria-hidden="true"
                          />
                          {showLabels ? (
                            <>
                              <span className="flex-1 truncate">{item.label}</span>
                              {count === undefined ? null : (
                                <span className="text-ink-faint font-mono text-[0.6875rem]">
                                  {count}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="sr-only">
                              {item.label}
                              {count === undefined ? '' : `, ${count}`}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

    </nav>
  )
}
