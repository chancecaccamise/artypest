import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeRemote, type FakeRemote } from '@/test/fake-remote'
import { buildDemoData } from './fixtures'
import { mergeEntities } from './merge'
import { withStableIds } from './stable-ids'
import { createSyncedProvider, type SyncedProvider } from './synced-provider'
import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'
import type { DataSnapshot, Entity, RelationType } from './types'

/*
  The association's records, shared through the database.

  Against a fake of the database rather than Supabase: what is tested here is
  the provider's side of the bargain, which is when it copies a county record
  in, what it sends, and what it shows afterwards. The SQL is tested against a
  real Postgres in supabase/schema.test.ts.
*/

const ORG = { id: 'a1b2c3d4-0000-4000-a000-000000000001', name: 'Thomas Square Neighborhood Association', sagisUrlTemplate: null, createdAt: '2026-01-01T00:00:00.000Z' }

/** The database's own ids for the same kinds the fixtures name `rt-*`. */
function databaseTypes(baseline: DataSnapshot): RelationType[] {
  return baseline.relationTypes.map((type) => ({
    ...type,
    id: `db-${type.key}`,
    orgId: ORG.id,
  }))
}

let baseline: DataSnapshot
let remote: FakeRemote

async function signIn(actor: string): Promise<SyncedProvider> {
  remote.actAs(actor)
  return createSyncedProvider({ remote, baseline, snapshot: await remote.loadAll() })
}

beforeEach(() => {
  baseline = withStableIds(
    buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [], { includeTemporaryData: false })
  ).data
  remote = createFakeRemote({ org: ORG, relationTypes: databaseTypes(baseline) })
})

const firstOf = (type: Entity['type']) => {
  const found = baseline.entities.find((entity) => entity.type === type)
  if (!found) throw new Error(`No ${type} in the client data`)
  return found
}

describe('the shared records', () => {
  it('opens on the supplied contacts before anybody has written anything', async () => {
    const provider = await signIn('dana@example.org')
    const people = await provider.listEntities({ type: 'person', pageSize: 500 })
    expect(people.total).toBe(baseline.entities.filter((entity) => entity.type === 'person').length)
  })

  it('reads the supplied connections under the database\'s own kinds', async () => {
    const provider = await signIn('dana@example.org')
    const relations = await provider.listRelations()
    expect(relations.length).toBeGreaterThan(0)
    expect(relations.every((relation) => relation.relationTypeId.startsWith('db-'))).toBe(true)
  })

  it('copies a record in silently the first time it is edited, then saves the edit', async () => {
    const provider = await signIn('dana@example.org')
    const person = firstOf('person')

    await provider.updateEntity(person.id, { data: { ...person.data, phone: '912-555-0100' } })

    expect(remote.materialized).toEqual([person.id])
    const history = await provider.listAuditEntries(person.id)
    // The edit and the check it implies; nothing for the copy.
    expect(history.map((entry) => entry.fieldName).sort()).toEqual(['data.phone', 'reviewedAt'])
    expect((await provider.getEntity(person.id))?.data.phone).toBe('912-555-0100')
  })

  it('copies both ends in before connecting them', async () => {
    const provider = await signIn('dana@example.org')
    const person = firstOf('person')
    const business = firstOf('business')
    const owns = (await provider.listRelationTypes()).find((type) => type.key === 'owns')

    await provider.createRelation({
      relationTypeId: owns?.id ?? '',
      fromEntityId: person.id,
      toEntityId: business.id,
    })

    expect(remote.materialized).toEqual(expect.arrayContaining([person.id, business.id]))
    expect((await provider.listRelations(person.id)).some((relation) => relation.toEntityId === business.id)).toBe(true)
  })

  it('shows one admin what another has done, after a refresh', async () => {
    const dana = await signIn('dana@example.org')
    const marcus = await signIn('marcus@example.org')

    const created = await dana.createEntity({ type: 'person', name: 'Greg Goeken', data: {} })
    expect(await marcus.getEntity(created.id)).toBeNull()

    expect(await marcus.refresh()).toBe(true)
    expect((await marcus.getEntity(created.id))?.name).toBe('Greg Goeken')
    // Nothing new the second time.
    expect(await marcus.refresh()).toBe(false)
  })

  it('attributes each write to whoever made it', async () => {
    const provider = await signIn('marcus@example.org')
    const created = await provider.createEntity({ type: 'business', name: 'Starland Handyman', data: {} })
    const [insert] = await provider.listAuditEntries(created.id)
    expect(insert?.changedBy).toBe('marcus@example.org')
    expect(await provider.listActors()).toContain('marcus@example.org')
  })

  it('carries a batch and its source onto every row it writes', async () => {
    const provider = await signIn('dana@example.org')
    const { batchId } = await provider.runBatch(async () => {
      await provider.createEntity({ type: 'property', name: '1 Import Way', data: {} })
      await provider.createEntity({ type: 'property', name: '2 Import Way', data: {} })
    }, 'import')

    const rows = remote.auditRows().filter((entry) => entry.batchId === batchId)
    expect(rows).toHaveLength(2)
    expect(rows.every((entry) => entry.source === 'import')).toBe(true)
  })

  it('names the record a connection starts from in Activity', async () => {
    const provider = await signIn('dana@example.org')
    const person = firstOf('person')
    const business = firstOf('business')
    const owns = (await provider.listRelationTypes()).find((type) => type.key === 'owns')
    await provider.createRelation({ relationTypeId: owns?.id ?? '', fromEntityId: person.id, toEntityId: business.id })

    const feed = await provider.listActivity({ pageSize: 10 })
    const connection = feed.rows.find((entry) => entry.tableName === 'relations')
    expect(connection?.entityName).toBe(person.name)

    const people = await provider.listActivity({ entityType: 'person', pageSize: 10 })
    expect(people.rows.every((entry) => entry.entityType === 'person')).toBe(true)
  })

  it('copies browser-only work in, creating what is new and updating what is not', async () => {
    const provider = await signIn('dana@example.org')
    const person = firstOf('person')
    const fresh: Entity = {
      ...person,
      id: crypto.randomUUID(),
      name: 'Kept In A Browser',
      data: {},
      reviewedAt: null,
      reviewedBy: null,
    }

    await provider.adoptEntity(fresh)
    await provider.adoptEntity({ ...person, data: { ...person.data, phone: '912-555-0199' } })
    // Copying the same work twice changes nothing the second time.
    const before = remote.auditRows().length
    await provider.adoptEntity({ ...person, data: { ...person.data, phone: '912-555-0199' } })

    expect((await provider.getEntity(fresh.id))?.name).toBe('Kept In A Browser')
    expect((await provider.getEntity(person.id))?.data.phone).toBe('912-555-0199')
    expect(remote.auditRows().length).toBe(before)
  })
})

const COUNTY_LOT: ParcelLayerRecord = {
  pin: '20065 38013',
  situsAddress: '104 E 40TH ST',
  ownerName: 'GOEKEN CHARLES',
  ownerName2: null,
  ownerMailingAddress: { street: '104 E 40TH ST', city: 'SAVANNAH', state: 'GA', zip: '31401' },
  acreage: 0.21,
  zoningDistrict: 'TC-1',
  propertyUseCode: 'C1',
  fairMarketValue: 544500,
  totalAssessment: 217800,
  yearBuilt: 1920,
  legalDescription: 'MERGE TEST',
  municipalityCode: '020',
  dateUpdated: '2026-01-01',
  lastSaleDate: null,
  lastSalePrice: null,
  saleQualityCode: null,
  neighborhood: 'Thomas Square',
}

describe('merging a duplicate into a county lot', () => {
  it('copies the county lot in, moves the connection onto it, and deletes the duplicate', async () => {
    // One county lot, so there is a lot still only in the county layer.
    baseline = withStableIds(
      buildDemoData(new Date('2026-10-16T00:00:00.000Z'), [COUNTY_LOT], {
        includeTemporaryData: false,
      })
    ).data
    remote = createFakeRemote({ org: ORG, relationTypes: databaseTypes(baseline) })
    const provider = await signIn('dana@example.org')
    const county = baseline.entities.find(
      (entity) => entity.type === 'property' && entity.data.pin === COUNTY_LOT.pin
    )
    if (!county) throw new Error('No county lot with a parcel number')

    const duplicate = await provider.createEntity({
      type: 'property',
      name: county.name,
      data: { pin: county.data.pin },
    })
    const person = firstOf('person')
    const relation = await provider.createRelation({
      relationTypeId: 'db-rents',
      fromEntityId: person.id,
      toEntityId: duplicate.id,
    })

    await mergeEntities(provider, county.id, duplicate.id)

    // The lot had to exist in the database before a connection could point at it.
    expect(remote.materialized).toContain(county.id)
    const after = await signIn('dana@example.org')
    const moved = (await after.listRelations(county.id)).find((row) => row.id === relation.id)
    expect(moved?.toEntityId).toBe(county.id)
    expect((await after.getEntity(duplicate.id))?.deletedAt).not.toBeNull()
  })
})
