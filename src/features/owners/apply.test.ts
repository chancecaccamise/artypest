import { beforeEach, describe, expect, it } from 'vitest'

import { createMemoryProvider } from '@/lib/data/memory-provider'
import { buildDemoData } from '@/lib/data/fixtures'
import type { DataProvider, Entity } from '@/lib/data/types'

import { applyOwnerPlan } from './apply'
import { reconcileOwners, type OwnerGroup } from './reconcile'

/*
  Committing a reconciliation.

  The two properties that matter: only the safe decisions are written, and
  running it twice does not double what it wrote the first time.
*/

const REFERENCE = new Date('2026-08-25T00:00:00.000Z')

let provider: DataProvider
let ownsTypeId: string

beforeEach(() => {
  provider = createMemoryProvider(buildDemoData(REFERENCE))
})

async function setup(owners: { pin: string; owner: string; sold?: string }[]) {
  const types = await provider.listRelationTypes()
  ownsTypeId = types.find((type) => type.key === 'owns')?.id ?? ''
  expect(ownsTypeId).not.toBe('')

  const properties: Entity[] = []
  for (const row of owners) {
    properties.push(
      await provider.createEntity({
        type: 'property',
        name: row.pin,
        data: { pin: row.pin, countyOwnerRaw: row.owner, lastSaleDate: row.sold ?? null },
      })
    )
  }
  return properties
}

function planFor(properties: Entity[], candidates: Entity[] = []): OwnerGroup[] {
  return reconcileOwners({ properties, candidates })
}

describe('applying the safe decisions', () => {
  it('creates one owner however many lots they hold, and an ownership for each', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'DRAYTON STREET LOFTS LLC' },
      { pin: '20099 00002', owner: 'DRAYTON STREET LOFTS LLC' },
      { pin: '20099 00003', owner: 'DRAYTON STREET LOFTS LLC' },
    ])

    const result = await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
    })

    expect(result.ownersCreated).toBe(1)
    expect(result.relationsCreated).toBe(3)
  })

  it('files each kind as itself', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'RANDALL ZOE' },
      { pin: '20099 00002', owner: 'LIBERTY COMMERCIAL RENTALS LLC' },
      /*
        Kept under 40 characters deliberately. The county truncates the owner
        field at exactly 40, so a name of that length is indistinguishable from
        one that lost its end and is correctly sent to review rather than
        created. `37 THE LOFTS CONDOMINIUM ASSOCIATION INC` is exactly 40.
      */
      { pin: '20099 00003', owner: 'MIDTOWN NEIGHBORHOOD ASSOCIATION INC' },
    ])

    await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
    })

    const created = (await provider.listAllEntities()).filter(
      (entity) => entity.data.parcelSource === 'reconciled'
    )
    expect(created.map((entity) => entity.type).sort()).toEqual([
      'association',
      'business',
      'person',
    ])
  })

  it('records the county sale date as the start of the ownership', async () => {
    /*
      As closely as the roll can say when this ownership began. It also makes
      the plat's age grading work on ownership: the brightest thread becomes the
      lot that changed hands most recently.
    */
    const properties = await setup([
      { pin: '20099 00001', owner: 'RANDALL ZOE', sold: '2019-04-01' },
    ])

    await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
    })

    const relation = (await provider.listRelations(properties[0]?.id)).find(
      (row) => row.relationTypeId === ownsTypeId
    )
    expect(relation?.startDate).toBe('2019-04-01')
  })

  it('leaves everything that needs a person alone', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'WILSON C V VAN' },
      { pin: '20099 00002', owner: 'KAYE & FORESTER-PY COURTNEY FORESTER &' },
    ])

    const groups = planFor(properties)
    expect(groups.every((group) => group.verdict === 'review')).toBe(true)

    const result = await applyOwnerPlan({
      provider,
      groups,
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
    })

    expect(result.ownersCreated).toBe(0)
    expect(result.relationsCreated).toBe(0)
  })

  it('does not double anything when it is run twice', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'DRAYTON STREET LOFTS LLC' },
      { pin: '20099 00002', owner: 'DRAYTON STREET LOFTS LLC' },
    ])
    const propertiesById = new Map(properties.map((p) => [p.id, p]))

    const first = await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById,
    })
    expect(first.relationsCreated).toBe(2)

    /*
      The second run reconciles against a directory that now contains the owner,
      so it links rather than creates, and every ownership is already on file.
    */
    const candidates = (await provider.listAllEntities()).filter(
      (entity) => entity.type === 'business'
    )
    const second = await applyOwnerPlan({
      provider,
      groups: planFor(properties, candidates),
      ownsRelationTypeId: ownsTypeId,
      propertiesById,
    })

    expect(second.ownersCreated).toBe(0)
    expect(second.ownersLinked).toBe(1)
    expect(second.relationsCreated).toBe(0)
    expect(second.relationsSkipped).toBe(2)
  })

  it('writes everything under one batch id, so Activity can show what it did', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'RANDALL ZOE' },
      { pin: '20099 00002', owner: 'LIBERTY COMMERCIAL RENTALS LLC' },
    ])

    const result = await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
    })

    expect(result.batchId).toBeTruthy()
    const feed = await provider.listActivity({ batchId: result.batchId, pageSize: 500 })
    expect(feed.rows.length).toBeGreaterThan(0)
  })

  it('reports progress as it goes, because this can be tens of thousands of writes', async () => {
    const properties = await setup([
      { pin: '20099 00001', owner: 'ALPHA HOLDINGS LLC' },
      { pin: '20099 00002', owner: 'BETA HOLDINGS LLC' },
    ])

    const seen: number[] = []
    await applyOwnerPlan({
      provider,
      groups: planFor(properties),
      ownsRelationTypeId: ownsTypeId,
      propertiesById: new Map(properties.map((p) => [p.id, p])),
      onProgress: (done) => seen.push(done),
    })

    expect(seen).toEqual([1, 2])
  })
})
