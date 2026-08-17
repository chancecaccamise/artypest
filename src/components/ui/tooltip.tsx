import { useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  className?: string
}

/*
  Hover and focus tooltip.

  The wrapper carries the listeners rather than the child because most of the
  tooltips in this app sit on deliberately disabled controls, and a disabled
  button fires no pointer events of its own.
*/
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'panel text-ink pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 px-2 py-1 text-xs',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          )}
          style={{ boxShadow: '0 4px 16px -6px color-mix(in srgb, var(--ink) 35%, transparent)' }}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
