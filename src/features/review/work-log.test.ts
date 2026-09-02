import { describe, expect, it } from 'vitest'

import type { ActivityEntry } from '@/lib/data/types'
import { buildWorkLog, describeEntry, recordsChecked } from './work-log'

/*
  The log is a reading of the audit trail, and the reading has to fold rows back
  into moves. A save that changed six fields is one thing the reader did, and a
  panel that lists it six times is a panel they stop looking at.
*/

let seq = 0
function row(
  recordId: string,
  changedAt: string,
  overrides: Partial<ActivityEntry> = {}
): ActivityEntry {
  seq += 1
  return {
    id: `aud-${String(seq)}`,
    orgId: 'org',
    tableName: 'entities',
    recordId,
    action: 'update',
    fieldName: 'data.zoning',
    oldValue: 'R-6',
    newValue: 'TN-2',
    changedBy: 'Teresa Vaughn',
    changedAt,
    source: 'hand',
    batchId: null,
    entityId: recordId,
    entityName: `Record ${recordId}`,
    entityType: 'property',
    ...overrides,
  }
}

describe('buildWorkLog', () => {
  it('folds one save into one entry, however many fields it changed', () => {
    const at = '2026-09-02T14:00:00.000Z'
    const log = buildWorkLog([
      row('a', at, { fieldName: 'data.zoning' }),
      row('a', at, { fieldName: 'data.acreage' }),
      row('a', at, { fieldName: 'data.notes' }),
    ])

    expect(log).toHaveLength(1)
    expect(log[0]?.kind).toBe('edited')
    expect(log[0]?.fields).toEqual(['Zoning', 'Acreage', 'Notes'])
    expect(log[0]?.rowCount).toBe(3)
  })

  it('keeps two saves to the same record apart', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T14:00:00.000Z'),
      row('a', '2026-09-02T15:00:00.000Z'),
    ])

    expect(log).toHaveLength(2)
  })

  /*
    A hand edit stamps the check as well as changing the fields. Reporting both
    would double the list, and "changed zoning" is what the reader actually did.
  */
  it('reports a save that both changed and checked as the change', () => {
    const at = '2026-09-02T14:00:00.000Z'
    const log = buildWorkLog([
      row('a', at, { fieldName: 'data.zoning' }),
      row('a', at, { fieldName: 'reviewedAt', oldValue: null, newValue: at }),
    ])

    expect(log).toHaveLength(1)
    expect(log[0]?.kind).toBe('edited')
    expect(log[0]?.fields).toEqual(['Zoning'])
  })

  it('reports a check on its own as a check', () => {
    const at = '2026-09-02T14:00:00.000Z'
    const log = buildWorkLog([row('a', at, { fieldName: 'reviewedAt', oldValue: null, newValue: at })])

    expect(log[0]?.kind).toBe('checked')
  })

  it('reports a cleared check as a cleared check', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T14:00:00.000Z', {
        fieldName: 'reviewedAt',
        oldValue: '2026-08-01T00:00:00.000Z',
        newValue: null,
      }),
    ])

    expect(log[0]?.kind).toBe('unchecked')
  })

  it('names creations, archives, restores, and connections', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T10:00:00.000Z', { action: 'insert', fieldName: null }),
      row('b', '2026-09-02T11:00:00.000Z', {
        fieldName: 'archivedAt',
        oldValue: null,
        newValue: '2026-09-02T11:00:00.000Z',
      }),
      row('c', '2026-09-02T12:00:00.000Z', {
        fieldName: 'archivedAt',
        oldValue: '2026-01-01T00:00:00.000Z',
        newValue: null,
      }),
      row('d', '2026-09-02T13:00:00.000Z', {
        tableName: 'relations',
        action: 'insert',
        fieldName: null,
      }),
    ])

    expect(log.map((entry) => entry.kind)).toEqual([
      'connected',
      'restored',
      'archived',
      'created',
    ])
  })

  /*
    Four hundred lots arriving from the county is one thing that happened, not
    four hundred, and none of them is the record the reader was working on.
  */
  it('collapses an import batch into one entry that names no record', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T09:00:00.000Z', { source: 'import', batchId: 'batch-1' }),
      row('b', '2026-09-02T09:00:01.000Z', { source: 'import', batchId: 'batch-1' }),
      row('c', '2026-09-02T09:00:02.000Z', { source: 'import', batchId: 'batch-1' }),
    ])

    expect(log).toHaveLength(1)
    expect(log[0]?.kind).toBe('imported')
    expect(log[0]?.entityId).toBeNull()
    expect(log[0]?.rowCount).toBe(3)
    // The newest row in the batch, so it sorts against hand work correctly.
    expect(log[0]?.at).toBe('2026-09-02T09:00:02.000Z')
  })

  it('lists newest first', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T09:00:00.000Z'),
      row('b', '2026-09-02T17:00:00.000Z'),
      row('c', '2026-09-02T12:00:00.000Z'),
    ])

    expect(log.map((entry) => entry.entityId)).toEqual(['b', 'c', 'a'])
  })
})

describe('recordsChecked', () => {
  it('counts each record once, however many times it was touched', () => {
    const log = buildWorkLog([
      row('a', '2026-09-02T09:00:00.000Z'),
      row('a', '2026-09-02T10:00:00.000Z'),
      row('b', '2026-09-02T11:00:00.000Z'),
      // Imports are the county's work, not the reader's.
      row('c', '2026-09-02T12:00:00.000Z', { source: 'import', batchId: 'batch-1' }),
    ])

    expect(recordsChecked(log)).toBe(2)
  })
})

describe('describeEntry', () => {
  const at = '2026-09-02T14:00:00.000Z'

  it('names one field, two fields, and then counts the rest', () => {
    const one = buildWorkLog([row('a', at, { fieldName: 'data.zoning' })])
    const two = buildWorkLog([
      row('b', at, { fieldName: 'data.zoning' }),
      row('b', at, { fieldName: 'data.acreage' }),
    ])
    const many = buildWorkLog([
      row('c', at, { fieldName: 'data.zoning' }),
      row('c', at, { fieldName: 'data.acreage' }),
      row('c', at, { fieldName: 'data.notes' }),
    ])

    expect(describeEntry(one[0]!)).toBe('zoning')
    expect(describeEntry(two[0]!)).toBe('zoning and acreage')
    expect(describeEntry(many[0]!)).toBe('zoning and 2 other fields')
  })
})
