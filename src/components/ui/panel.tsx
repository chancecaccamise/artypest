import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
  Panel is the one card surface in the app. Hairline border, 6px radius, no
  shadow. Structure comes from rules, not elevation.
*/
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel flex min-w-0 flex-col', className)} {...props} />
}

export interface PanelHeaderProps {
  title: string
  /** Sits to the right of the title in mono, for counts and dates. */
  meta?: ReactNode
  /** Sits at the far right, for links and buttons. */
  action?: ReactNode
  className?: string
}

export function PanelHeader({ title, meta, action, className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'border-rule flex min-h-11 items-center justify-between gap-3 border-b px-4 py-2',
        className
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="label-caps truncate">{title}</h2>
        {meta ? <span className="text-ink-faint font-mono text-xs">{meta}</span> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 flex-1 p-4', className)} {...props} />
}

export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-rule text-ink-muted flex items-center justify-between gap-3 border-t px-4 py-2 text-xs',
        className
      )}
      {...props}
    />
  )
}
