/*
  Display formatting. One place, so a date reads the same on the dashboard, in
  a table cell, and in an audit diff.

  Dates are rendered in the viewer's locale but always with an explicit month
  name, because 03/04/2026 means two different days depending on who is reading
  it and this is a records product.
*/

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const DAY_HEADER_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

const CURRENCY_FORMAT = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** A bare `YYYY-MM-DD` is a calendar date, so it is parsed as UTC noon to
 *  avoid the off-by-one that local-midnight parsing causes west of Greenwich. */
function toDate(value: string): Date | null {
  if (value === '') return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = toDate(value)
  return parsed ? DATE_FORMAT.format(parsed) : value
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = toDate(value)
  return parsed ? DATE_TIME_FORMAT.format(parsed) : value
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = toDate(value)
  return parsed ? TIME_FORMAT.format(parsed) : value
}

export function formatDayHeader(value: string): string {
  const parsed = toDate(value)
  return parsed ? DAY_HEADER_FORMAT.format(parsed) : value
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return CURRENCY_FORMAT.format(value)
}

export function formatAcreage(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return `${value.toFixed(3)} ac`
}

/** Whole percent. Rounding hides that 0 of 0 is not 0 percent, so callers
 *  check for an empty denominator before asking. */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/**
 * `single_family` becomes `Single family`. Used for any stored slug that has
 * no entry in the org's reference lists, so a value is never rendered raw.
 */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  if (spaced === '') return ''
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Whole days from today to an ISO date. Negative means the date has passed. */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = toDate(isoDate)
  if (!target) return Number.NaN

  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

  return Math.round((targetUtc - todayUtc) / 86_400_000)
}

/** "in 12 days", "today", "34 days ago". Reads in a sentence. */
export function formatRelativeDays(days: number): string {
  if (Number.isNaN(days)) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}

/*
  The `data` column is JSONB, so every field arrives as `unknown`. These two
  are the only sanctioned way to read one. Blindly calling String() on an
  unknown turns a nested object into "[object Object]" in the middle of a
  table cell, which is exactly the kind of thing nobody notices until a board
  member screenshots it.
*/

/** A primitive as text. Objects, arrays, and functions read as empty. */
export function readString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return value.toString()
  return ''
}

/** A stored number, or null when the field holds anything else. */
export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * A stored slug: one or more lowercase words joined by underscores, as the app
 * writes them. One word counts, so `open` and `single_family` are rendered the
 * same way instead of one being capitalised and the other not.
 */
const SLUG = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * Renders a stored audit value for a board member to read.
 *
 * The log records exactly what changed, so nothing here alters the comparison
 * that produced the row: it only presents the value. A slug reads as words, a
 * timestamp reads as a date, and anything else is shown verbatim rather than
 * guessed at.
 */
export function formatAuditValue(value: string | null): string {
  if (value === null || value === '') return 'not set'
  if (ISO_DATETIME.test(value)) return formatDateTime(value)
  if (ISO_DATE.test(value)) return formatDate(value)
  if (SLUG.test(value)) return humanize(value)
  return value
}

/** The field name from an audit row, without the `data.` prefix, humanized. */
export function formatFieldName(fieldName: string | null): string {
  if (!fieldName) return ''
  const bare = fieldName.startsWith('data.') ? fieldName.slice(5) : fieldName
  // camelCase to spaced words, then sentence case.
  return humanize(bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
}
