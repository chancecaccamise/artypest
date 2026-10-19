import { beforeEach, describe, expect, it } from 'vitest'

import { buildDemoData } from './fixtures'
import { mergeData, mergeEntities } from './merge'
import { createMemoryProvider } from './memory-provider'
import type { DataProvider, Entity } from './types'

const REFERENCE = new Date('2026-07-31T00:00:00.000Z')

describe('mergeData', () => {
  it('keeps the kept record\'s values and fills only its blanks', () => {
    const { data, filled } = mergeData(
      { pin: '20065 38013', propertyUse: 'commercial', zoning: null },
      { pin: '20065 38013', propertyUse: 'residential', zoning: 'TC-1', yearBuilt: 1925 }
    )
    expect(data).toEqual({
      pin: '20065 38013',
      propertyUse: 'commercial',
      zoning: 'TC-1',
      yearBuilt: 1925,
    })
    expect(filled).toEqual(['zoning', 'yearBuilt'])
  })

  it('pools images and joins notes rather than choosing one', () => {
    const { data } = mergeData(
      { images: ['a'], notes: 'Gate code on file.' },
      { images: ['a', 'b'], notes: 'Tenant is Knack Pottery.' }
    )
    expect(data.images).toEqual(['a', 'b'])
    expect(data.notes).toBe('Gate code on file.\n\nTenant is Knack Pottery.')
  })

  it('treats a map location as one value, not a list to pool', () => {
    const { data } = mergeData({ location: [-81.1, 32.05] }, { location: [-81.2, 32.06] })
    expect(data.location).toEqual([-81.1, 32.05])
  })
})

describe('mergeEntities', () => {
  let data: DataProvider
  let keep: Entity
  let drop: Entity
  let tenant: Entity
  let typeId: (key: string) => string

  beforeEach(async () => {
    data = createMemoryProvider(buildDemoData(REFERENCE))
    const types = await data.listRelationTypes()
    typeId = (key) => types.find((type) => type.key === key)?.id ?? ''

    keep = await data.createEntity({
      type: 'property',
      name: '104 E 40TH ST',
      data: { pin: '20065 38013', propertyUse: 'commercial' },
    })
    drop = await data.createEntity({
      type: 'property',
      name: '104 E 40th St',
      data: { pin: '20065 38013', zoning: 'TC-1' },
    })
    tenant = await data.createEntity({ type: 'business', name: 'Knack Pottery' })
  })

  it('moves the duplicate\'s connections onto the kept record and deletes it', async () => {
    const relation = await data.createRelation({
      relationTypeId: typeId('rents'),
      fromEntityId: tenant.id,
      toEntityId: drop.id,
    })

    const summary = await mergeEntities(data, keep.id, drop.id)

    expect(summary.moved).toBe(1)
    const moved = (await data.listRelations(keep.id)).find((row) => row.id === relation.id)
    expect(moved?.fromEntityId).toBe(tenant.id)
    expect(moved?.toEntityId).toBe(keep.id)
    expect(await data.listRelations(drop.id)).toEqual([])

    const gone = await data.getEntity(drop.id)
    expect(gone?.deletedAt).not.toBeNull()
    expect(gone?.data.mergedInto).toBe(keep.id)
  })

  it('fills the kept record\'s blank fields from the duplicate', async () => {
    const summary = await mergeEntities(data, keep.id, drop.id)
    expect(summary.filled).toEqual(['zoning'])
    expect(summary.kept.data).toMatchObject({ propertyUse: 'commercial', zoning: 'TC-1' })
  })

  it('drops a connection both records already had, instead of drawing it twice', async () => {
    for (const lot of [keep, drop]) {
      await data.createRelation({
        relationTypeId: typeId('rents'),
        fromEntityId: tenant.id,
        toEntityId: lot.id,
        startDate: lot === drop ? '2024-03-01' : null,
      })
    }

    const summary = await mergeEntities(data, keep.id, drop.id)

    expect(summary).toMatchObject({ moved: 0, removed: 1 })
    const remaining = await data.listRelations(keep.id)
    expect(remaining).toHaveLength(1)
    // The kept connection had no start date, so it takes the duplicate's.
    expect(remaining[0]?.startDate).toBe('2024-03-01')
  })

  it('drops a connection between the two, which would otherwise point at itself', async () => {
    await data.createRelation({
      relationTypeId: typeId('related_to'),
      fromEntityId: keep.id,
      toEntityId: drop.id,
    })
    const summary = await mergeEntities(data, keep.id, drop.id)
    expect(summary.removed).toBe(1)
    expect(await data.listRelations(keep.id)).toEqual([])
  })

  it('repoints a to do that was about the duplicate', async () => {
    const todo = await data.createEntity({
      type: 'record',
      name: 'Call about the lease',
      data: { subjectId: drop.id },
    })
    const summary = await mergeEntities(data, keep.id, drop.id)
    expect(summary.references).toBe(1)
    expect((await data.getEntity(todo.id))?.data.subjectId).toBe(keep.id)
  })

  it('refuses two different kinds of record', async () => {
    await expect(mergeEntities(data, keep.id, tenant.id)).rejects.toThrow(
      /only be merged with another/
    )
  })

  it('runs as one batch, so Activity shows it as one action', async () => {
    await data.createRelation({
      relationTypeId: typeId('rents'),
      fromEntityId: tenant.id,
      toEntityId: drop.id,
    })
    await mergeEntities(data, keep.id, drop.id)

    const feed = await data.listActivity({ pageSize: 50 })
    const merged = feed.rows.filter(
      (entry) => entry.recordId === drop.id && entry.fieldName === 'deletedAt'
    )
    expect(merged).toHaveLength(1)
    const batch = merged[0]?.batchId
    expect(batch).toBeTruthy()
    expect(feed.rows.filter((entry) => entry.batchId === batch).length).toBeGreaterThan(2)
  })
})
