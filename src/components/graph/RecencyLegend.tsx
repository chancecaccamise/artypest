import { formatDate } from '@/lib/format'
import { NEWEST_STRENGTH, OLDEST_STRENGTH, type RecencyScale } from '@/lib/relations/recency'
import { cn } from '@/lib/utils'

/*
  What the brightness of a thread means, and over what dates.

  A gradient with no scale on it is decoration. This one names the two ends, so
  "brighter is more recent" becomes "brighter is 2019 rather than 1998", which
  is the difference between a nice effect and something a board member can read
  a fact off.

  It also says when there is nothing to grade. Eight lots that all joined the
  same month produce a flat ramp, and a legend that implied otherwise would be
  inventing a story the data does not support.
*/
export function RecencyLegend({
  scale,
  /** How the threads are grouped for grading, said out loud rather than left to be guessed. */
  groupedBy,
  className,
}: {
  scale: RecencyScale
  groupedBy?: 'fan' | 'type'
  className?: string
}) {
  if (scale.dated === 0) {
    return (
      <p className={cn('text-ink-faint text-13', className)}>
        None of these connections has a recorded date, so there is nothing to grade yet.
      </p>
    )
  }

  if (!scale.hasSpread) {
    return (
      <p className={cn('text-ink-muted text-13', className)}>
        Every dated connection here begins around {formatDate(scale.newest)}, so they are drawn
        alike. There is no spread to show.
        {scale.undated > 0 ? ` ${String(scale.undated)} have no date recorded.` : ''}
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <span className="label-caps text-ink-faint text-[0.6875rem]">Older</span>
        <span
          aria-hidden="true"
          className="border-rule h-2 min-w-16 flex-1 rounded-[2px] border"
          style={{
            backgroundImage: `linear-gradient(to right,
              color-mix(in srgb, var(--ink) ${String(OLDEST_STRENGTH * 100)}%, transparent),
              color-mix(in srgb, var(--ink) ${String(NEWEST_STRENGTH * 100)}%, transparent))`,
          }}
        />
        <span className="label-caps text-ink text-[0.6875rem]">Newer</span>
      </div>
      <p className="text-ink-muted font-mono text-xs">
        {formatDate(scale.oldest)} to {formatDate(scale.newest)}
        <span className="text-ink-faint"> ({scale.spanDays.toLocaleString()} days)</span>
      </p>
      {groupedBy === 'fan' ? (
        <p className="text-ink-faint text-13">
          Each group of threads is graded against itself, so the brightest line under a card is the
          most recent connection that card has. Brightness compares within a group, not across two
          of them.
        </p>
      ) : null}
      {groupedBy === 'type' ? (
        <p className="text-ink-faint text-13">
          Each kind of connection is graded against itself, so the brightest membership is the most
          recent membership. Brightness compares within a type, not across two of them.
        </p>
      ) : null}
      {scale.undated > 0 ? (
        <p className="text-ink-faint text-13">
          {scale.undated} with no date recorded, drawn mid strength because neither end would be
          true.
        </p>
      ) : null}
    </div>
  )
}
