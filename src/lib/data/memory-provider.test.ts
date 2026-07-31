import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryProvider } from './memory-provider'
import type { DataProvider } from './types'

describe('memory provider', () => {
  let data: DataProvider

  beforeEach(() => {
    data = createMemoryProvider()
  })

  it('lists only active entities by default', async () => {
    const page = await data.listEntities()
    expect(page.rows.every((entity) => entity.archivedAt === null)).toBe(true)
    expect(page.rows.every((entity) => entity.deletedAt === null)).toBe(true)
  })

  it('filters by entity type', async () => {
    const page = await data.listEntities({ type: 'property' })
    expect(page.rows).not.toHaveLength(0)
    expect(page.rows.every((entity) => entity.type === 'property')).toBe(true)
  })

  it('searches across name and data', async () => {
    const byName = await data.listEntities({ search: 'Abercorn' })
    expect(byName.rows).toHaveLength(1)

    const byData = await data.listEntities({ search: '10993C01034' })
    expect(byData.rows).toHaveLength(1)
    expect(byData.rows[0]?.id).toBe(byName.rows[0]?.id)
  })

  it('paginates and reports the unpaginated total', async () => {
    const page = await data.listEntities({ page: 1, pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBeGreaterThan(2)
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
    const fromOwner = await data.listRelations('ent-person-hollis')
    const fromProperty = await data.listRelations('ent-property-1207-washington')

    const ids = new Set(fromProperty.map((relation) => relation.id))
    expect(fromOwner.some((relation) => ids.has(relation.id))).toBe(true)
  })

  it('ships the ten seeded relation types, each with both directions labelled', async () => {
    const types = await data.listRelationTypes()
    expect(types).toHaveLength(10)
    expect(types.every((type) => type.label !== '' && type.reverseLabel !== '')).toBe(true)
    expect(new Set(types.map((type) => type.key)).size).toBe(10)
  })
})
