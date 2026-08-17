import { beforeEach, describe, expect, it } from 'vitest'

import { buildDemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'
import type { DataProvider } from './types'

/** A fixed reference date, so every relative fixture date is deterministic. */
const REFERENCE = new Date('2026-07-31T00:00:00.000Z')

describe('memory provider', () => {
  let data: DataProvider

  beforeEach(() => {
    data = createMemoryProvider(buildDemoData(REFERENCE))
  })

  it('lists only active entities by default', async () => {
    const page = await data.listEntities({ pageSize: 500 })
    expect(page.rows.every((entity) => entity.archivedAt === null)).toBe(true)
    expect(page.rows.every((entity) => entity.deletedAt === null)).toBe(true)
  })

  it('filters by entity type', async () => {
    const page = await data.listEntities({ type: 'property', pageSize: 500 })
    expect(page.rows).not.toHaveLength(0)
    expect(page.rows.every((entity) => entity.type === 'property')).toBe(true)
  })

  it('searches across name and data', async () => {
    const properties = await data.listEntities({ type: 'property', pageSize: 500 })
    const target = properties.rows.find((entity) => typeof entity.data.pin === 'string')
    expect(target).toBeDefined()

    const byPin = await data.listEntities({ search: String(target?.data.pin), pageSize: 500 })
    expect(byPin.rows.map((entity) => entity.id)).toContain(target?.id)
  })

  it('filters on a key inside the JSONB data column', async () => {
    const page = await data.listEntities({
      type: 'property',
      dataFilters: { propertyUse: 'commercial' },
      pageSize: 500,
    })
    expect(page.rows).not.toHaveLength(0)
    expect(page.rows.every((entity) => entity.data.propertyUse === 'commercial')).toBe(true)
  })

  it('paginates and reports the unpaginated total', async () => {
    const page = await data.listEntities({ page: 1, pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBeGreaterThan(2)
  })

  it('sorts by the requested column and direction', async () => {
    const ascending = await data.listEntities({ type: 'person', sortBy: 'name', sortDir: 'asc' })
    const descending = await data.listEntities({ type: 'person', sortBy: 'name', sortDir: 'desc' })

    expect(ascending.rows[0]?.name).not.toBe(descending.rows[0]?.name)
    expect(ascending.rows[0]?.name).toBe(
      [...ascending.rows].sort((a, b) => a.name.localeCompare(b.name))[0]?.name
    )
  })

  it('counts only active entities per type', async () => {
    const counts = await data.countsByType()
    const properties = await data.listEntities({ type: 'property', pageSize: 500 })

    expect(counts.property).toBe(properties.total)
    expect(counts.person).toBeGreaterThan(0)
    expect(counts.association).toBe(3)
  })

  it('treats archive and soft delete as separate states', async () => {
    const created = await data.createEntity({ type: 'person', name: 'Ines Barrow' })

    const archived = await data.archiveEntity(created.id)
    expect(archived.archivedAt).not.toBeNull()
    expect(archived.deletedAt).toBeNull()

    const restored = await data.restoreEntity(created.id)
    expect(restored.archivedAt).toBeNull()

    const deleted = await data.deleteEntity(created.id)
    expect(deleted.deletedAt).not.toBeNull()
    expect(deleted.archivedAt).toBeNull()
  })

  it('writes one audit row per changed field', async () => {
    const created = await data.createEntity({
      type: 'property',
      name: '14 Gaston St',
      data: { zoning: 'R-6', propertyUse: 'single_family' },
    })

    await data.updateEntity(created.id, {
      name: '14 W Gaston St',
      data: { zoning: 'R-6', propertyUse: 'commercial' },
    })

    const history = await data.listAuditEntries(created.id)
    const fields = history.map((entry) => entry.fieldName)

    expect(fields).toContain('name')
    expect(fields).toContain('data.propertyUse')
    // Zoning did not change, so it must not appear in the diff.
    expect(fields).not.toContain('data.zoning')

    const useChange = history.find((entry) => entry.fieldName === 'data.propertyUse')
    expect(useChange?.oldValue).toBe('single_family')
    expect(useChange?.newValue).toBe('commercial')
  })

  it('returns relations from either end of the stored row', async () => {
    const relations = await data.listRelations()
    const sample = relations[0]
    expect(sample).toBeDefined()
    if (!sample) return

    const fromLeft = await data.listRelations(sample.fromEntityId)
    const fromRight = await data.listRelations(sample.toEntityId)

    expect(fromLeft.map((relation) => relation.id)).toContain(sample.id)
    expect(fromRight.map((relation) => relation.id)).toContain(sample.id)
  })

  it('audits relation changes, not just entity changes', async () => {
    const people = await data.listEntities({ type: 'person' })
    const properties = await data.listEntities({ type: 'property' })
    const owner = people.rows[0]
    const property = properties.rows[0]
    expect(owner && property).toBeTruthy()
    if (!owner || !property) return

    const relation = await data.createRelation({
      relationTypeId: 'rt-owns',
      fromEntityId: owner.id,
      toEntityId: property.id,
      startDate: '2026-01-01',
    })

    const history = await data.listAuditEntries(relation.id)
    expect(history.some((entry) => entry.tableName === 'relations')).toBe(true)

    await data.deleteRelation(relation.id)
    const after = await data.listRelations(owner.id)
    expect(after.map((row) => row.id)).not.toContain(relation.id)
  })

  it('ships the ten seeded relation types, each with both directions labelled', async () => {
    const types = await data.listRelationTypes()
    expect(types).toHaveLength(10)
    expect(types.every((type) => type.label !== '' && type.reverseLabel !== '')).toBe(true)
    expect(new Set(types.map((type) => type.key)).size).toBe(10)
  })

  it('resolves the subject entity on the activity feed', async () => {
    const feed = await data.listActivity({ pageSize: 20 })
    expect(feed.rows).not.toHaveLength(0)
    expect(feed.rows.some((entry) => entry.entityName !== null)).toBe(true)
  })

  it('sorts the activity feed newest first', async () => {
    const feed = await data.listActivity({ pageSize: 50 })
    const stamps = feed.rows.map((entry) => entry.changedAt)
    expect(stamps).toEqual([...stamps].sort((a, b) => b.localeCompare(a)))
  })

  it('filters activity by type, action, actor, and inclusive date range', async () => {
    const byType = await data.listActivity({ entityType: 'property', pageSize: 500 })
    expect(byType.rows.every((entry) => entry.entityType === 'property')).toBe(true)

    const byAction = await data.listActivity({ action: 'insert', pageSize: 500 })
    expect(byAction.rows.every((entry) => entry.action === 'insert')).toBe(true)

    const actors = await data.listActors()
    const actor = actors[0]
    expect(actor).toBeDefined()
    if (actor) {
      const byActor = await data.listActivity({ actor, pageSize: 500 })
      expect(byActor.rows.every((entry) => entry.changedBy === actor)).toBe(true)
    }

    const all = await data.listActivity({ pageSize: 500 })
    const anchor = all.rows[0]?.changedAt.slice(0, 10)
    expect(anchor).toBeDefined()
    if (anchor) {
      const sameDay = await data.listActivity({ from: anchor, to: anchor, pageSize: 500 })
      expect(sameDay.rows.every((entry) => entry.changedAt.slice(0, 10) === anchor)).toBe(true)
      expect(sameDay.rows).not.toHaveLength(0)
    }
  })

  it('groups every audit row a batch causes under one batch id', async () => {
    const { batchId } = await data.runBatch(async () => {
      await data.createEntity({ type: 'property', name: '77 Test Ln' })
      await data.createEntity({ type: 'person', name: 'Batch Tester' })
    })

    const batch = await data.listActivity({ batchId, pageSize: 500 })
    expect(batch.total).toBe(2)
    expect(batch.rows.every((entry) => entry.batchId === batchId)).toBe(true)

    // Work outside a batch stays ungrouped.
    await data.createEntity({ type: 'person', name: 'Unbatched' })
    const still = await data.listActivity({ batchId, pageSize: 500 })
    expect(still.total).toBe(2)
  })

  it('updates the org and audits the change', async () => {
    const updated = await data.updateOrg({ sagisUrlTemplate: 'https://example.test/{pin}' })
    expect(updated.sagisUrlTemplate).toBe('https://example.test/{pin}')

    const history = await data.listAuditEntries(updated.id)
    expect(history.some((entry) => entry.fieldName === 'sagisUrlTemplate')).toBe(true)
  })

  it('manages reference data without rewriting stored values', async () => {
    const before = await data.listReferenceItems('zoning')
    const first = before[0]
    expect(first).toBeDefined()
    if (!first) return

    const renamed = await data.updateReferenceItem(first.id, { label: 'R-6, Renamed' })
    expect(renamed.label).toBe('R-6, Renamed')
    // The stored value is what entities reference, so it must not move.
    expect(renamed.value).toBe(first.value)

    const created = await data.createReferenceItem({ list: 'zoning', label: 'PUD Overlay' })
    expect(created.value).toBe('pud_overlay')

    const deactivated = await data.updateReferenceItem(created.id, { active: false })
    expect(deactivated.active).toBe(false)
  })
})
