import type { ReactNode } from 'react'

import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/*
  Anywhere a feature is deliberately unavailable, the control is visibly
  disabled and labelled with when it arrives. Never a dead button, never a
  silent no-op. This wrapper is how that promise is kept in one place.
*/

export function PhaseTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'border-rule text-ink-faint inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap',
        className
      )}
    >
      {children}
    </span>
  )
}

export interface UnavailableProps {
  /** What the control will do once it is available. */
  reason: string
  children: ReactNode
  className?: string
}

/** Wraps a disabled control so hovering or focusing it explains the wait. */
export function Unavailable({ reason, children, className }: UnavailableProps) {
  return (
    <Tooltip label={reason} className={className}>
      {children}
    </Tooltip>
  )
}
