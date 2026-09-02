import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, RotateCcw, X } from 'lucide-react'

import { ENTITY_ROUTES, entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useActivity, useActor, useCounts, useReviewIndex } from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS, type EntityType } from '@/lib/data/types'
import { formatDateTime, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWorkSession } from './session'
import {
  buildWorkLog,
  describeEntry,
  recordCount,
  recordsChecked,
  KIND_VERB,
  type WorkLogEntry,
} from './work-log'

/*
  The work log.

  Somebody reconciling a printed owner list against this application looks away
  from the screen every few seconds. The two questions they come back with are
  always the same: what was the last one I did, and how much is left. Neither
  is answerable from a directory page, and both are answerable from the audit
  log, which is already keeping the record.

  So the panel is a reading of the log rather than a new thing to maintain, and
  it is docked rather than floated: it has to be legible while the list beside
  it is being worked, not instead of it.
*/

/** Generous: a long sitting, still one query, and the panel shows the newest. */
const SESSION_ROW_LIMIT = 500

export interface WorkLogPanelProps {
  onClose: () => void
  /** Docked beside the page on a laptop, a sheet over it on a phone. */
  variant?: 'docked' | 'sheet'
}

export function WorkLogPanel({ onClose, variant = 'docked' }: WorkLogPanelProps) {
  const actor = useActor()
  const counts = useCounts()
  const reviewIndex = useReviewIndex()

  // Shared with the count in the header, so the two are always the same claim.
  const { since, startFresh } = useWorkSession()

  const activity = useActivity({
    actor: actor.data,
    since,
    pageSize: SESSION_ROW_LIMIT,
  })

  const log = useMemo(() => buildWorkLog(activity.data?.rows ?? []), [activity.data])
  const checked = recordsChecked(log)

  const last = log.find((entry) => entry.entityId !== null)
  /*
    Which list they are working. Taken from what they last touched rather than
    from the route, so stepping into a person's record to fix a phone number
    does not re-point the meter away from the properties they are working
    through.
  */
  const workingType = last?.entityType ?? null

  return (
    <aside
      aria-label="Work log"
      className={cn(
        'bg-paper-raised border-rule flex h-full min-h-0 w-[21rem] shrink-0 flex-col border-l',
        variant === 'sheet' && 'panel-enter w-[min(21rem,85vw)]'
      )}
    >
      <div className="border-rule flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <h2 className="font-display text-ink truncate text-sm font-bold">Work log</h2>
          <p className="text-ink-faint truncate font-mono text-2xs">
            {checked === 0 ? 'Nothing yet this session' : `${recordCount(checked)} this session`}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the work log">
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activity.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={8} />
          </div>
        ) : (
          <>
            <LastEntry entry={last} />
            <Progress
              type={workingType}
              total={workingType ? (counts.data?.[workingType] ?? 0) : 0}
              checked={workingType ? (reviewIndex.data?.checkedByType[workingType] ?? 0) : 0}
              recheck={workingType ? (reviewIndex.data?.recheckByType[workingType] ?? 0) : 0}
            />
            <Entries log={log} />
          </>
        )}
      </div>

      <div className="border-rule text-ink-faint flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-2xs">
        <span className="truncate font-mono">Since {formatDateTime(since)}</span>
        <Button variant="ghost" size="sm" onClick={startFresh} className="shrink-0">
          <RotateCcw />
          Start fresh
        </Button>
      </div>
    </aside>
  )
}

/*
  Where they were.

  Pinned above the list rather than left as its first row, because "the last one
  I did" is a different question from "what have I done", and after a phone call
  it is the only one being asked.
*/
function LastEntry({ entry }: { entry: WorkLogEntry | undefined }) {
  if (!entry || entry.entityId === null || entry.entityType === null) {
    return (
      <div className="border-rule border-b p-3">
        <p className="label-caps mb-1">Where you were</p>
        <p className="text-ink-muted text-13">
          Nothing yet. Check or change a record and it will be listed here, newest first.
        </p>
      </div>
    )
  }

  return (
    <div className="border-rule bg-paper-sunken/60 border-b p-3">
      <p className="label-caps mb-1">Where you were</p>
      <Link
        to={entityHref(entry.entityType, entry.entityId)}
        className="text-ink hover:text-survey block text-sm font-semibold"
      >
        {entry.entityName}
      </Link>
      <p className="text-ink-muted mt-0.5 text-xs">
        {KIND_VERB[entry.kind]}
        {describeEntry(entry) === '' ? '' : ` ${describeEntry(entry)}`} at{' '}
        <span className="font-mono">{formatTime(entry.at)}</span>
      </p>
    </div>
  )
}

/*
  How much is left.

  A count on its own ("214 checked") does not answer it; a fraction does, and
  the link under it turns the answer into the next piece of work rather than
  something to feel bad about.
*/
function Progress({
  type,
  total,
  checked,
  recheck,
}: {
  type: EntityType | null
  total: number
  checked: number
  recheck: number
}) {
  if (type === null || total === 0) return null

  const label = ENTITY_TYPE_LABELS[type].plural
  const remaining = Math.max(0, total - checked)
  const percent = Math.round((checked / total) * 100)

  return (
    <div className="border-rule border-b p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="label-caps">{label} checked</p>
        <p className="text-ink-muted font-mono text-xs">
          {checked.toLocaleString()} / {total.toLocaleString()}
        </p>
      </div>

      {/* A rule that fills, in keeping with the hairlines everywhere else. */}
      <div
        className="bg-paper-sunken h-1 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${String(percent)} percent of ${label.toLowerCase()} checked`}
      >
        <div className="bg-moss h-full" style={{ width: `${String(percent)}%` }} />
      </div>

      <div className="mt-2 flex flex-col gap-1">
        <Link
          to={`${ENTITY_ROUTES[type]}?review=unchecked`}
          className="text-survey inline-flex items-center gap-1 text-13 hover:underline"
        >
          <ArrowRight className="size-3.5" aria-hidden="true" />
          {remaining.toLocaleString()} still to check
        </Link>

        {recheck > 0 ? (
          <Link
            to={`${ENTITY_ROUTES[type]}?review=recheck`}
            className="text-amber inline-flex items-center gap-1 text-13 hover:underline"
          >
            <ArrowRight className="size-3.5" aria-hidden="true" />
            {recheck.toLocaleString()} changed by the county since you checked
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function Entries({ log }: { log: WorkLogEntry[] }) {
  if (log.length === 0) {
    return (
      <p className="text-ink-faint p-3 text-13">
        Everything you enter, change, or check will be listed here as you go.
      </p>
    )
  }

  return (
    <ol className="divide-rule flex flex-col divide-y">
      {log.map((entry) => (
        <li key={entry.key} className="flex gap-2 px-3 py-2">
          <span className="text-ink-faint w-12 shrink-0 pt-0.5 font-mono text-2xs">
            {formatTime(entry.at)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-13">
              <span className="text-ink-muted">{KIND_VERB[entry.kind]}</span>{' '}
              {entry.entityId && entry.entityType ? (
                <Link
                  to={entityHref(entry.entityType, entry.entityId)}
                  className="text-ink hover:text-survey font-medium"
                >
                  {entry.entityName}
                </Link>
              ) : (
                <span className="text-ink font-medium">{describeEntry(entry)}</span>
              )}
            </p>

            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {entry.entityType ? (
                <TypeBadge type={entry.entityType} className="py-0 text-2xs">
                  {ENTITY_TYPE_LABELS[entry.entityType].singular}
                </TypeBadge>
              ) : null}
              {entry.entityId && describeEntry(entry) !== '' ? (
                <span className="text-ink-faint truncate text-xs">{describeEntry(entry)}</span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
