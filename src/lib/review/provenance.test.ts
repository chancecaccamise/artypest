import { describe, expect, it } from 'vitest'

import type { AuditEntry, AuditSource } from '@/lib/data/types'
import { fieldSources, isHandEntered } from './provenance'

let seq = 0
function audit(
  fieldName: string | null,
  changedAt: string,
  source: AuditSource,
  overrides: Partial<AuditEntry> = {}
): AuditEntry {
  seq += 1
  return {
    id: `aud-${String(seq)}`,
    orgId: 'org',
    tableName: 'entities',
    recordId: 'ent-1',
    action: 'update',
    fieldName,
    oldValue: 'before',
    newValue: 'after',
    changedBy: 'Teresa Vaughn',
    changedAt,
    source,
    batchId: null,
    ...overrides,
  }
}

describe('fieldSources', () => {
  it('reports the source of the most recent write to each field', () => {
    const sources = fieldSources([
      audit('data.zoning', '2026-01-01T00:00:00.000Z', 'hand'),
      audit('data.zoning', '2026-06-01T00:00:00.000Z', 'import'),
      audit('data.notes', '2026-03-01T00:00:00.000Z', 'hand'),
    ])

    // The county wrote last, so the value on screen is the county's.
    expect(sources.get('zoning')).toBe('import')
    expect(sources.get('notes')).toBe('hand')
  })

  it('is not confused by the order rows arrive in', () => {
    const rows = [
      audit('data.zoning', '2026-06-01T00:00:00.000Z', 'hand'),
      audit('data.zoning', '2026-01-01T00:00:00.000Z', 'import'),
    ]

    expect(fieldSources(rows).get('zoning')).toBe('hand')
    expect(fieldSources([...rows].reverse()).get('zoning')).toBe('hand')
  })

  it('strips the data prefix so the key matches the field definition', () => {
    const sources = fieldSources([audit('name', '2026-01-01T00:00:00.000Z', 'hand')])
    expect(sources.get('name')).toBe('hand')
  })

  /*
    An insert row says the record was created, not that anybody read any
    particular field on it, and a relation row is not about a field at all.
  */
  it('ignores creations, deletions, and relation rows', () => {
    const sources = fieldSources([
      audit(null, '2026-01-01T00:00:00.000Z', 'hand', { action: 'insert' }),
      audit(null, '2026-01-02T00:00:00.000Z', 'hand', { action: 'delete' }),
      audit('data.zoning', '2026-01-03T00:00:00.000Z', 'hand', { tableName: 'relations' }),
    ])

    expect(sources.size).toBe(0)
  })

  it('answers the question the field grid asks', () => {
    const sources = fieldSources([audit('data.propertyUse', '2026-01-01T00:00:00.000Z', 'hand')])
    expect(isHandEntered(sources, 'propertyUse')).toBe(true)
    expect(isHandEntered(sources, 'zoning')).toBe(false)
  })
})
