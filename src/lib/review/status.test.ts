import { describe, expect, it } from 'vitest'

import type { AuditEntry, AuditSource, Entity } from '@/lib/data/types'
import { buildReviewIndex, fieldsChangedSince, reviewStateOf, stateFor } from './status'

/*
  The rule this file exists to pin down: a check is a claim about a record at a
  moment, and the county writing to that record afterwards ends the claim. Get
  the comparison backwards and the application shows a green tick on a lot whose
  zoning changed last week, which is worse than showing nothing at all.
*/

function entity(id: string, reviewedAt: string | null, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    orgId: 'org',
    type: 'property',
    name: id,
    data: {},
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt,
    reviewedBy: reviewedAt === null ? null : 'Teresa Vaughn',
    ...overrides,
  }
}

let seq = 0
function audit(
  recordId: string,
  changedAt: string,
  source: AuditSource,
  fieldName: string | null = 'data.zoning'
): AuditEntry {
  seq += 1
  return {
    id: `aud-${String(seq)}`,
    orgId: 'org',
    tableName: 'entities',
    recordId,
    action: 'update',
    fieldName,
    oldValue: 'R-6',
    newValue: 'TN-2',
    changedBy: 'SAGIS parcel import',
    changedAt,
    source,
    batchId: null,
  }
}

describe('reviewStateOf', () => {
  it('is unchecked when nobody has read the record', () => {
    expect(reviewStateOf(entity('a', null), null)).toBe('unchecked')
  })

  it('is unchecked even when the county has written to it', () => {
    expect(reviewStateOf(entity('a', null), '2026-06-01T00:00:00.000Z')).toBe('unchecked')
  })

  it('is checked when a person read it and nothing has written since', () => {
    expect(reviewStateOf(entity('a', '2026-06-01T00:00:00.000Z'), null)).toBe('checked')
    expect(
      reviewStateOf(entity('a', '2026-06-01T00:00:00.000Z'), '2026-05-01T00:00:00.000Z')
    ).toBe('checked')
  })

  it('needs a recheck when the county wrote to it after the check', () => {
    expect(
      reviewStateOf(entity('a', '2026-05-01T00:00:00.000Z'), '2026-06-01T00:00:00.000Z')
    ).toBe('recheck')
  })

  /*
    A tie carries no evidence of which write came first, and the two ways of
    being wrong are not equally bad: a green tick on a record the county has
    rewritten is a claim nobody made.
  */
  it('asks for a recheck when the check and the import land at the same moment', () => {
    const at = '2026-06-01T00:00:00.000Z'
    expect(reviewStateOf(entity('a', at), at)).toBe('recheck')
  })
})

describe('buildReviewIndex', () => {
  const checked = entity('checked', '2026-06-01T00:00:00.000Z')
  const stale = entity('stale', '2026-05-01T00:00:00.000Z')
  const never = entity('never', null)
  const archived = entity('archived', '2026-06-01T00:00:00.000Z', {
    archivedAt: '2026-06-02T00:00:00.000Z',
  })

  const entries = [
    audit('stale', '2026-06-15T00:00:00.000Z', 'import'),
    // A hand edit after the check must not make the record stale: it is the
    // same person, doing the reading, not the county overwriting it.
    audit('checked', '2026-07-01T00:00:00.000Z', 'hand'),
  ]

  const index = buildReviewIndex([checked, stale, never, archived], entries)

  it('holds only records that have been checked', () => {
    expect([...index.byEntity.keys()].sort()).toEqual(['archived', 'checked', 'stale'])
  })

  it('reports a record the county has written to since as needing a recheck', () => {
    expect(index.byEntity.get('stale')?.state).toBe('recheck')
    expect(index.byEntity.get('checked')?.state).toBe('checked')
  })

  it('names the fields that changed since the check', () => {
    expect(index.byEntity.get('stale')?.changedSince).toEqual(['Zoning'])
    expect(index.byEntity.get('checked')?.changedSince).toEqual([])
  })

  it('counts against the active working set, not the archive', () => {
    expect(index.checkedByType.property).toBe(1)
    expect(index.recheckByType.property).toBe(1)
  })

  it('treats a record it does not hold as unchecked', () => {
    expect(stateFor(index, 'never')).toBe('unchecked')
    expect(stateFor(undefined, 'checked')).toBe('unchecked')
  })
})

describe('fieldsChangedSince', () => {
  const entries = [
    audit('a', '2026-06-10T00:00:00.000Z', 'import', 'data.zoning'),
    audit('a', '2026-06-11T00:00:00.000Z', 'import', 'data.assessedValue'),
    // Repeated, and listed once.
    audit('a', '2026-06-12T00:00:00.000Z', 'import', 'data.zoning'),
    // Before the check, so not part of what changed since.
    audit('a', '2026-01-01T00:00:00.000Z', 'import', 'data.acreage'),
    // Exactly at the check. Counted, because this is the row that made it stale.
    audit('a', '2026-06-01T00:00:00.000Z', 'import', 'data.acreage'),
    // A hand edit is not the county writing over the reader's work.
    audit('a', '2026-06-13T00:00:00.000Z', 'hand', 'data.notes'),
    // Another record entirely.
    audit('b', '2026-06-14T00:00:00.000Z', 'import', 'data.zoning'),
  ]

  it('names each county field once, in the order it was changed', () => {
    expect(fieldsChangedSince(entries, 'a', '2026-06-01T00:00:00.000Z')).toEqual([
      'Zoning',
      'Assessed value',
      'Acreage',
    ])
  })
})
