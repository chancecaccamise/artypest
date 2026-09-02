import { beforeEach, describe, expect, it } from 'vitest'

import { buildDemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'
import type { DataProvider } from './types'

/** A fixed reference date, so every relative fixture date is deterministic. */
const REFERENCE = new Date('2026-07-31T00:00:00.000Z')

/*
  The hand mark, through the provider.

  These are the behaviours the Postgres port has to reproduce: a hand write
  claims the mark, an import never does, and a check is an audited field change
  rather than a quiet flag.
*/
describe('the hand mark', () => {
  let data: DataProvider

  beforeEach(() => {
    data = createMemoryProvider(buildDemoData(REFERENCE))
  })

  async function anUncheckedProperty() {
    const page = await data.listEntities({ type: 'property', review: 'unchecked', pageSize: 1 })
    const entity = page.rows[0]
    expect(entity).toBeDefined()
    return entity!
  }

  it('records a check against the record and says who made it', async () => {
    const before = await anUncheckedProperty()
    expect(before.reviewedAt).toBeNull()

    const after = await data.setReviewed(before.id, true)
    expect(after.reviewedAt).not.toBeNull()
    expect(after.reviewedBy).toBe(await data.getActor())
  })

  it('audits the check, so it appears in history and in the work log', async () => {
    const target = await anUncheckedProperty()
    await data.setReviewed(target.id, true)

    const history = await data.listAuditEntries(target.id)
    const check = history.find((entry) => entry.fieldName === 'reviewedAt')

    expect(check).toBeDefined()
    expect(check?.source).toBe('hand')
    expect(check?.newValue).not.toBeNull()
  })

  it('clears a check back to unchecked, and audits that too', async () => {
    const target = await anUncheckedProperty()
    await data.setReviewed(target.id, true)

    const cleared = await data.setReviewed(target.id, false)
    expect(cleared.reviewedAt).toBeNull()
    expect(cleared.reviewedBy).toBeNull()

    const history = await data.listAuditEntries(target.id)
    expect(history.some((entry) => entry.fieldName === 'reviewedAt' && entry.newValue === null)).toBe(
      true
    )
  })

  /*
    Somebody who opened a record and saved it has read it. This is what makes
    the mark worth anything during a reconciliation: the reader does not have
    to remember a second action after every correction.
  */
  it('claims the mark when a person edits a record', async () => {
    const target = await anUncheckedProperty()
    const edited = await data.updateEntity(target.id, {
      data: { ...target.data, notes: 'Spoke to the owner. Address confirmed.' },
    })

    expect(edited.reviewedAt).not.toBeNull()
  })

  /*
    The distinction the whole feature rests on. Whoever pressed the button ran
    the import; they did not read the lots it wrote.
  */
  it('does not claim the mark for anything written by an import', async () => {
    const target = await anUncheckedProperty()

    await data.runBatch(async () => {
      await data.updateEntity(target.id, { data: { ...target.data, zoning: 'TN-2' } })
    }, 'import')

    const after = await data.getEntity(target.id)
    expect(after?.reviewedAt).toBeNull()

    const history = await data.listAuditEntries(target.id)
    expect(history.some((entry) => entry.source === 'import')).toBe(true)
  })

  it('creates a record with the mark by hand and without it on an import', async () => {
    const byHand = await data.createEntity({ type: 'person', name: 'Hand Entered' })
    expect(byHand.reviewedAt).not.toBeNull()

    const { result: imported } = await data.runBatch(
      () => data.createEntity({ type: 'property', name: 'From the roll' }),
      'import'
    )
    expect(imported.reviewedAt).toBeNull()
  })

  it('turns a record stale when an import writes to it after the check', async () => {
    const target = await anUncheckedProperty()
    await data.setReviewed(target.id, true)
    expect((await data.listReviewIndex()).byEntity.get(target.id)?.state).toBe('checked')

    await data.runBatch(async () => {
      const current = await data.getEntity(target.id)
      await data.updateEntity(target.id, { data: { ...current?.data, zoning: 'TN-2' } })
    }, 'import')

    const status = (await data.listReviewIndex()).byEntity.get(target.id)
    expect(status?.state).toBe('recheck')
    expect(status?.changedSince).toContain('Zoning')
  })

  it('filters the directory down to a work queue', async () => {
    const unchecked = await data.listEntities({ type: 'property', review: 'unchecked', pageSize: 500 })
    expect(unchecked.rows).not.toHaveLength(0)
    expect(unchecked.rows.every((entity) => entity.reviewedAt === null)).toBe(true)

    const checked = await data.listEntities({ type: 'property', review: 'checked', pageSize: 500 })
    expect(checked.rows).not.toHaveLength(0)
    expect(checked.rows.every((entity) => entity.reviewedAt !== null)).toBe(true)

    // A record can only be in one queue at a time.
    const uncheckedIds = new Set(unchecked.rows.map((entity) => entity.id))
    expect(checked.rows.some((entity) => uncheckedIds.has(entity.id))).toBe(false)
  })

  it('ships a demo with all three states represented', async () => {
    const index = await data.listReviewIndex()
    expect(index.checkedByType.property).toBeGreaterThan(0)
    expect(index.recheckByType.property).toBeGreaterThan(0)

    const unchecked = await data.listEntities({ type: 'property', review: 'unchecked', pageSize: 1 })
    expect(unchecked.total).toBeGreaterThan(0)
  })

  it('narrows the feed to a moment, not a day', async () => {
    const target = await anUncheckedProperty()
    const before = new Date().toISOString()
    await data.setReviewed(target.id, true)

    const since = await data.listActivity({ since: before, pageSize: 500 })
    expect(since.rows).not.toHaveLength(0)
    expect(since.rows.every((entry) => entry.changedAt >= before)).toBe(true)

    const handOnly = await data.listActivity({ source: 'hand', pageSize: 500 })
    expect(handOnly.rows.every((entry) => entry.source === 'hand')).toBe(true)
  })
})
