import type { Theming } from './theming'
import { cn } from '@/lib/utils'

/*
  The thematic legend. One bucket per row, with a count.

  A bucket with no lots in it is still listed, at reduced emphasis. "No lots are
  missing an owner" is information; an absent row is just a gap the reader has
  to notice for themselves.
*/
export function MapLegend({ theming }: { theming: Theming }) {
  if (theming.legend.length === 0) return null

  const total = theming.legend.reduce((sum, bucket) => sum + bucket.count, 0)

  return (
    <div className="flex flex-col gap-1">
      <p className="label-caps text-[0.6875rem]">Legend</p>
      <ul className="flex flex-col gap-1">
        {theming.legend.map((bucket) => (
          <li
            key={bucket.key}
            className={cn('flex items-center gap-2 text-13', bucket.count === 0 && 'opacity-45')}
          >
            <span
              aria-hidden="true"
              className="border-rule size-2.5 shrink-0 rounded-[2px] border"
              style={{
                backgroundColor: `color-mix(in srgb, ${bucket.color} 42%, transparent)`,
                borderColor: bucket.color,
              }}
            />
            <span className="text-ink-muted min-w-0 flex-1 truncate">{bucket.label}</span>
            <span className="text-ink shrink-0 font-mono text-xs">{bucket.count}</span>
            <span className="text-ink-faint w-9 shrink-0 text-right font-mono text-xs">
              {total === 0 ? '0%' : `${Math.round((bucket.count / total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
