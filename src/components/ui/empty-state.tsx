import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** What is not here. Stated, not apologised for. */
  title: string
  /** What to do next. */
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-rule flex flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed px-6 py-10 text-center',
        className
      )}
    >
      <p className="text-ink text-sm font-semibold">{title}</p>
      {description ? <p className="text-ink-muted max-w-md text-13">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/**
 * Inline notice. `info` is the neutral statement of fact used for the parcel
 * banner, which is deliberately not styled as an error.
 */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'error'
  children: ReactNode
  className?: string
}) {
  const toneClasses = {
    info: 'border-survey/40 text-ink',
    warning: 'border-amber/50 text-ink',
    error: 'border-oxblood/50 text-ink',
  }[tone]

  const accent = { info: 'var(--survey)', warning: 'var(--amber)', error: 'var(--oxblood)' }[tone]

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[3px] border border-l-[3px] px-3 py-2 text-13',
        toneClasses,
        className
      )}
      style={{
        borderLeftColor: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 7%, transparent)`,
      }}
    >
      {children}
    </div>
  )
}
