import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface Crumb {
  label: string
  to?: string
}

export interface PageHeaderProps {
  title: string
  /** Rendered under the title. Counts, subtitles, status lines. */
  subtitle?: ReactNode
  /** Chips and badges rendered beside the title. */
  meta?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
  className?: string
  /** Display size. Detail pages use 34px, list pages 26px. */
  size?: 'page' | 'record'
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  breadcrumbs,
  className,
  size = 'page',
}: PageHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-col gap-2', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="text-ink-muted flex flex-wrap items-center gap-1 text-xs">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight className="text-ink-faint size-3" aria-hidden="true" />
                ) : null}
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-survey hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1
              className={cn(
                'font-display text-ink leading-tight font-bold tracking-tight',
                size === 'record' ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
              )}
            >
              {title}
            </h1>
            {meta}
          </div>
          {subtitle ? <div className="text-ink-muted mt-1 text-13">{subtitle}</div> : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
