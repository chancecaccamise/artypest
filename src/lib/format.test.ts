import { describe, expect, it } from 'vitest'

import {
  daysUntil,
  formatAuditValue,
  formatFieldName,
  formatPercent,
  formatRelativeDays,
  humanize,
  readNumber,
  readString,
} from './format'

describe('readString', () => {
  it('passes primitives through as text', () => {
    expect(readString('R-6')).toBe('R-6')
    expect(readString(1926)).toBe('1926')
    expect(readString(true)).toBe('true')
  })

  it('reads a missing value as empty rather than as "null"', () => {
    expect(readString(null)).toBe('')
    expect(readString(undefined)).toBe('')
  })

  it('never renders an object as [object Object]', () => {
    expect(readString({ a: 1 })).toBe('')
    expect(readString([1, 2])).toBe('')
    expect(readString(Number.NaN)).toBe('')
  })
})

describe('readNumber', () => {
  it('reads a number, and a numeric string from a form input', () => {
    expect(readNumber(0.399)).toBe(0.399)
    expect(readNumber('412000')).toBe(412000)
  })

  it('returns null for anything that is not a number', () => {
    expect(readNumber(null)).toBeNull()
    expect(readNumber('')).toBeNull()
    expect(readNumber('R-6')).toBeNull()
    expect(readNumber({})).toBeNull()
  })
})

describe('humanize', () => {
  it('turns a stored slug into words a board member reads', () => {
    expect(humanize('single_family')).toBe('Single family')
    expect(humanize('covenant_violation')).toBe('Covenant violation')
  })

  it('leaves an already-readable value alone', () => {
    expect(humanize('Commercial')).toBe('Commercial')
  })
})

describe('formatAuditValue', () => {
  it('says "not set" rather than showing an empty cell', () => {
    expect(formatAuditValue(null)).toBe('not set')
    expect(formatAuditValue('')).toBe('not set')
  })

  it('reads a stored slug as words', () => {
    expect(formatAuditValue('single_family')).toBe('Single family')
  })

  it('treats a one-word slug the same as a multi-word one', () => {
    // Otherwise "open to In review" reads as though only one side is a value.
    expect(formatAuditValue('open')).toBe('Open')
    expect(formatAuditValue('commercial')).toBe('Commercial')
  })

  it('reads a timestamp as a date rather than as an ISO string', () => {
    expect(formatAuditValue('2026-04-02T11:00:00.000Z')).not.toContain('T11:00')
    expect(formatAuditValue('2026-04-02')).not.toBe('2026-04-02')
  })

  it('leaves a value it cannot classify exactly as recorded', () => {
    // An audit log that rewrites values it does not understand is worse than
    // one that shows them raw.
    expect(formatAuditValue('R-6')).toBe('R-6')
    expect(formatAuditValue('912-555-0188')).toBe('912-555-0188')
    expect(formatAuditValue('412000')).toBe('412000')
    expect(formatAuditValue('Ray Guthrie')).toBe('Ray Guthrie')
  })
})

describe('formatFieldName', () => {
  it('drops the data prefix and spaces out camel case', () => {
    expect(formatFieldName('data.propertyUse')).toBe('Property use')
    expect(formatFieldName('data.assessedValue')).toBe('Assessed value')
  })

  it('handles a top-level column', () => {
    expect(formatFieldName('name')).toBe('Name')
    expect(formatFieldName('archivedAt')).toBe('Archived at')
  })

  it('returns empty for a row with no field, which is a create or a delete', () => {
    expect(formatFieldName(null)).toBe('')
  })
})

describe('daysUntil', () => {
  const today = new Date('2026-07-31T00:00:00.000Z')

  it('counts forward and backward from today', () => {
    expect(daysUntil('2026-08-01', today)).toBe(1)
    expect(daysUntil('2026-07-31', today)).toBe(0)
    expect(daysUntil('2026-07-01', today)).toBe(-30)
  })

  it('does not drift by a day west of Greenwich', () => {
    // A bare calendar date parsed at local midnight lands on the previous day
    // in a negative offset. Parsing at noon UTC is what avoids that.
    expect(daysUntil('2026-07-31', new Date('2026-07-31T23:00:00.000Z'))).toBe(0)
  })
})

describe('formatRelativeDays', () => {
  it('reads in a sentence', () => {
    expect(formatRelativeDays(0)).toBe('today')
    expect(formatRelativeDays(1)).toBe('tomorrow')
    expect(formatRelativeDays(-1)).toBe('yesterday')
    expect(formatRelativeDays(12)).toBe('in 12 days')
    expect(formatRelativeDays(-34)).toBe('34 days ago')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(26, 48)).toBe('54%')
    expect(formatPercent(1, 3)).toBe('33%')
  })

  it('does not divide by zero', () => {
    expect(formatPercent(0, 0)).toBe('0%')
  })
})
