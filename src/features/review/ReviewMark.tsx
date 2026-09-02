import { Check, CircleDashed, RotateCcw } from 'lucide-react'

import { Tooltip } from '@/components/ui/tooltip'
import { useSetReviewed } from '@/hooks/use-data'
import type { ReviewState, ReviewStatus } from '@/lib/data/types'
import { formatDate } from '@/lib/format'
import { REVIEW_STATE_LABELS } from '@/lib/review/status'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

/*
  The hand mark, drawn.

  One vocabulary, used at every scale, so a reader learns it once:

    a moss tick      a person has read this and vouches for it
    an amber arrow   they did, and the county has written to it since
    a hollow ring    nobody has been through it yet

  Marked rather than tinted, and marked on the positive state. The plat carries
  16,656 county lots against a few dozen the association has read, so shading
  the unread ones would shade almost the whole screen and say nothing. The
  quiet state is the common one; the ink goes where the work went.

  Colour is never the only carrier. Each state has its own glyph and its own
  words, because a board member printing a list in greyscale, or reading it
  without distinguishing moss from amber, still has to be able to tell them
  apart.
*/

const STATE_ICON = {
  checked: Check,
  recheck: RotateCcw,
  unchecked: CircleDashed,
} as const

const STATE_CLASSES: Record<ReviewState, string> = {
  checked: 'border-moss/45 text-moss',
  recheck: 'border-amber/45 text-amber',
  unchecked: 'border-rule text-ink-faint',
}

/** The 2px leading rule down the edge of a row or a card. */
const EDGE_COLOR: Record<ReviewState, string | null> = {
  checked: 'var(--moss)',
  recheck: 'var(--amber)',
  unchecked: null,
}

/** The full sentence. Shown in tooltips and on the record itself. */
export function reviewSentence(state: ReviewState, status: ReviewStatus | undefined): string {
  if (state === 'unchecked' || !status?.reviewedAt) {
    return 'Nobody has checked this record yet.'
  }

  const who = status.reviewedBy ?? 'Someone'
  const when = formatDate(status.reviewedAt)

  if (state === 'checked') return `Checked by ${who} on ${when}.`

  const fields = status.changedSince
  const what =
    fields.length === 0
      ? 'the county has written to it since'
      : fields.length === 1
        ? `the county has changed ${fields[0]?.toLowerCase()} since`
        : `the county has changed ${String(fields.length)} fields since`

  return `Checked by ${who} on ${when}, and ${what}.`
}

/**
 * The leading edge rule, as a style.
 *
 * An inset shadow rather than a border or a positioned element: it costs the
 * row no width, it does not move a single pixel of the layout when a record is
 * checked, and it survives `border-collapse`, which a border on a table cell
 * does not. A column of them reads as one continuous gutter down the side of
 * the list.
 *
 * Decorative. Every row carrying one also states its state in words.
 */
export function reviewEdgeStyle(state: ReviewState): { boxShadow: string } | undefined {
  const color = EDGE_COLOR[state]
  return color === null ? undefined : { boxShadow: `inset 2px 0 0 ${color}` }
}

export interface ReviewMarkProps {
  state: ReviewState
  status?: ReviewStatus
  /** Hides the word beside the glyph, for a table column that is already narrow. */
  compact?: boolean
  className?: string
}

/** The read-only mark: glyph, and the state in words unless space is short. */
export function ReviewMark({ state, status, compact = false, className }: ReviewMarkProps) {
  const Icon = STATE_ICON[state]

  const sentence = reviewSentence(state, status)

  return (
    <Tooltip label={sentence}>
      <span
        role="img"
        aria-label={sentence}
        className={cn(
          'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-xs font-semibold',
          STATE_CLASSES[state],
          className
        )}
      >
        <Icon className="size-3" aria-hidden="true" />
        {compact ? null : REVIEW_STATE_LABELS[state]}
      </span>
    </Tooltip>
  )
}

export interface ReviewToggleProps extends ReviewMarkProps {
  entityId: string
  /** Set on a row that is itself clickable, so the mark does not open the record. */
  stopPropagation?: boolean
}

/**
 * The mark, clickable.
 *
 * Checking is the single most repeated action in a paper-list session, so it
 * is one click from wherever the reader already is rather than something to be
 * found in a menu. A record in `recheck` toggles to checked, not to unchecked:
 * the useful next move on a stale mark is to renew it.
 */
export function ReviewToggle({
  entityId,
  state,
  status,
  compact = false,
  stopPropagation = false,
  className,
}: ReviewToggleProps) {
  const setReviewed = useSetReviewed()
  const { canEdit } = useRole()

  if (!canEdit) return <ReviewMark state={state} status={status} compact={compact} className={className} />

  const Icon = STATE_ICON[state]
  const next = state !== 'checked'
  const action =
    state === 'checked' ? 'Clear the check on this record' : 'Mark this record as checked'

  /*
    The whole sentence, not just the verb. A tooltip is a hover, and somebody
    reading this list with a screen reader needs the same thing a sighted
    reader gets from hovering: who checked it, when, and what has changed since.
  */
  const label = `${reviewSentence(state, status)} ${action}.`

  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={state === 'checked'}
        disabled={setReviewed.isPending}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation()
          setReviewed.mutate({ entityId, reviewed: next })
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-xs font-semibold transition-colors duration-[120ms] disabled:opacity-50',
          STATE_CLASSES[state],
          state === 'checked'
            ? 'hover:border-rule-strong hover:text-ink-muted'
            : 'hover:border-moss hover:text-moss',
          className
        )}
      >
        <Icon className="size-3" aria-hidden="true" />
        {compact ? (
          <span className="sr-only">{REVIEW_STATE_LABELS[state]}</span>
        ) : (
          REVIEW_STATE_LABELS[state]
        )}
      </button>
    </Tooltip>
  )
}

/**
 * The small moss dot beside a field a person typed.
 *
 * Deliberately quieter than the record mark. It answers a different question,
 * asked once the reader is already looking at one record: of these eleven
 * fields, which did we write and which came off the roll?
 */
export function HandFieldDot({ label }: { label: string }) {
  return (
    <Tooltip label={`${label} was entered by hand, not imported from the county.`}>
      <span
        className="bg-moss inline-block size-1.5 shrink-0 rounded-full align-middle"
        role="img"
        aria-label={`${label} was entered by hand`}
      />
    </Tooltip>
  )
}
