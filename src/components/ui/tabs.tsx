import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface TabDefinition {
  value: string
  label: string
  /**
   * How many items the tab holds. Shown beside the label so a reader can see
   * there are two properties and no documents without opening either.
   * A zero is still shown: "nothing here" is an answer.
   */
  count?: number
}

export interface TabsProps {
  tabs: readonly TabDefinition[]
  value: string
  onChange: (value: string) => void
  className?: string
  /** Rendered at the right end of the tab strip. */
  action?: ReactNode
}

/*
  Tab strip following the WAI-ARIA tabs pattern: roving tabindex, arrow keys
  move between tabs, Home and End jump to the ends.

  Panels are rendered by the caller so the tab strip does not force a
  particular content layout.
*/
export function Tabs({ tabs, value, onChange, className, action }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = tabs.findIndex((tab) => tab.value === value)
      if (currentIndex === -1) return

      let nextIndex: number | null = null
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % tabs.length
          break
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = tabs.length - 1
          break
        default:
          return
      }

      const next = tabs[nextIndex]
      if (!next) return

      event.preventDefault()
      onChange(next.value)
      listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.value}"]`)?.focus()
    },
    [onChange, tabs, value]
  )

  return (
    <div className={cn('border-rule flex items-end justify-between gap-4 border-b', className)}>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={handleKeyDown}
        className="scrollbar-none -mb-px flex overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = tab.value === value
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              data-tab={tab.value}
              id={`tab-${tab.value}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors duration-[120ms]',
                selected
                  ? 'border-moss text-ink font-semibold'
                  : 'text-ink-muted hover:text-ink border-transparent'
              )}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <span
                  className={cn(
                    'rounded-full px-1.5 font-mono text-[0.6875rem]',
                    tab.count === 0
                      ? 'text-ink-faint'
                      : selected
                        ? 'bg-moss/15 text-moss'
                        : 'bg-paper-sunken text-ink-muted'
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 pb-1.5">{action}</div> : null}
    </div>
  )
}

export function TabPanel({
  value,
  active,
  children,
  className,
}: {
  value: string
  active: boolean
  children: ReactNode
  className?: string
}) {
  if (!active) return null
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className={cn('panel-enter focus-visible:outline-none', className)}
    >
      {children}
    </div>
  )
}
