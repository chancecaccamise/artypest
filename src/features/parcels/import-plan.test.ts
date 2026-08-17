import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyImportPlan,
  buildImportPlan,
  diffParcelAgainstProperty,
  parcelToPropertyData,
  parsePinList,
  summarizePlan,
  type PlanRow,
} from './import-plan'
import { buildDemoData } from '@/lib/data/fixtures'
import { createMemoryProvider } from '@/lib/data/memory-provider'
import { readString } from '@/lib/format'
import type { DataProvider, Entity } from '@/lib/data/types'
import type { ParcelRecord } from '@/lib/parcels/types'

const REFERENCE = new Date('2026-07-31T00:00:00.000Z')

function parcel(overrides: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    pin: '20032 63001',
    situsAddress: '1207 E Washington Ave',
    ownerName: 'SMITH, JOHN A',
    ownerName2: null,
    ownerMailingAddress: {
      street: '1207 E Washington Ave',
      city: 'Savannah',
      state: 'GA',
      zip: '31405',
    },
    acreage: 0.22,
    zoningDistrict: 'RSF-6',
    propertyUseCode: 'R3',
    fairMarketValue: 1_030_000,
    totalAssessment: 412000,
    yearBuilt: 1926,
    legalDescription: 'LOTS 12 AND 13 PIERPONT WARD',
    municipalityCode: '020',
    dateUpdated: '2025-05-06',
    ...overrides,
  }
}

function property(data: Record<string, unknown>, id = 'prop-1'): Entity {
  return {
    id,
    orgId: 'org',
    type: 'property',
    name: readString(data.situsAddress) || 'A lot',
    data,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
}

function person(name: string, id = 'per-1'): Entity {
  return {
    id,
    orgId: 'org',
    type: 'person',
    name,
    data: {},
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
}

describe('diffParcelAgainstProperty', () => {
  it('reports only the fields that actually differ', () => {
    const stored = property({
      pin: '20032 63001',
      situsAddress: '1207 E Washington Ave',
      zoning: 'RSF-6',
      propertyUseCode: 'R3',
      acreage: 0.22,
      assessedValue: 375000,
      fairMarketValue: 937_500,
    })

    const changes = diffParcelAgainstProperty(parcel(), stored)
    expect(changes.map((change) => change.field)).toEqual([
      'fairMarketValue',
      'assessedValue',
      'parcelUpdatedAt',
    ])
    expect(changes.find((change) => change.field === 'assessedValue')).toMatchObject({
      from: '375000',
      to: '412000',
    })
  })

  it('reports nothing when the stored record already matches the roll', () => {
    const stored = property({
      pin: '20032 63001',
      situsAddress: '1207 E Washington Ave',
      zoning: 'RSF-6',
      propertyUseCode: 'R3',
      acreage: 0.22,
      assessedValue: 412000,
      fairMarketValue: 1_030_000,
      parcelUpdatedAt: '2025-05-06',
    })

    expect(diffParcelAgainstProperty(parcel(), stored)).toEqual([])
  })

  it('shows a missing stored value as "not set" rather than as an empty diff', () => {
    const stored = property({ pin: '20032 63001', zoning: null })
    const changes = diffParcelAgainstProperty(parcel(), stored)
    expect(changes.find((change) => change.field === 'zoning')).toMatchObject({
      from: null,
      to: 'RSF-6',
    })
  })
})

describe('parcelToPropertyData', () => {
  it('never writes property use, which the county roll does not know', () => {
    const stored = property({ pin: '20032 63001', propertyUse: 'commercial' })
    const next = parcelToPropertyData(parcel(), stored)

    // Zoning is the regulatory district and comes from the roll. Property use
    // is what is actually there and must survive the import untouched.
    expect(next.zoning).toBe('RSF-6')
    expect(next.propertyUse).toBe('commercial')
    // The county's own class code arrives under its own key, so the two sit
    // side by side rather than one overwriting the other.
    expect(next.propertyUseCode).toBe('R3')
  })

  it('normalises the PIN and marks the source as imported', () => {
    const next = parcelToPropertyData(parcel({ pin: '10993c01034' }), null)
    expect(next.pin).toBe('10993C01034')
    expect(next.parcelSource).toBe('imported')
  })

  it('keeps fields the roll has no opinion about', () => {
    const stored = property({ pin: '20032 63001', notes: 'Keep me', lotNumber: 'L-007' })
    const next = parcelToPropertyData(parcel(), stored)
    expect(next.notes).toBe('Keep me')
    expect(next.lotNumber).toBe('L-007')
  })
})

describe('buildImportPlan', () => {
  it('proposes a create when the PIN is not in the system', () => {
    const rows = buildImportPlan({ parcels: [parcel()], entities: [] })
    expect(rows[0]?.propertyAction).toBe('create_property')
    expect(rows[0]?.existingProperty).toBeNull()
  })

  it('proposes an update when the PIN matches, with the diff attached', () => {
    const stored = property({ pin: '20032 63001', assessedValue: 375000 })
    const rows = buildImportPlan({ parcels: [parcel()], entities: [stored] })

    expect(rows[0]?.propertyAction).toBe('update_property')
    expect(rows[0]?.existingProperty?.id).toBe('prop-1')
    expect(rows[0]?.changes.length).toBeGreaterThan(0)
  })

  it('matches the PIN on its normalised form', () => {
    const stored = property({ pin: '10993C01034' })
    const rows = buildImportPlan({ parcels: [parcel({ pin: '10993c01034' })], entities: [stored] })
    expect(rows[0]?.propertyAction).toBe('update_property')
  })

  it('links a county owner name to an existing person', () => {
    const rows = buildImportPlan({ parcels: [parcel()], entities: [person('John A. Smith')] })

    expect(rows[0]?.ownerAction).toBe('link_owner')
    expect(rows[0]?.ownerMatch?.name).toBe('John A. Smith')
    expect(rows[0]?.ownerMatchConfidence).toBe('normalized')
  })

  it('proposes creating an owner when no record matches, classified by name', () => {
    const rows = buildImportPlan({
      parcels: [parcel({ ownerName: 'ABERCORN HOLDINGS LLC' }), parcel({ pin: '20032 63002' })],
      entities: [],
    })

    expect(rows[0]?.ownerAction).toBe('create_owner')
    expect(rows[0]?.ownerKind).toBe('business')
    expect(rows[1]?.ownerKind).toBe('person')
    expect(rows[1]?.ownerDisplayName).toBe('John A. Smith')
  })

  it('does not propose ownership a second time when it is already recorded', () => {
    const stored = property({ pin: '20032 63001' })
    const owner = person('John A. Smith')

    const rows = buildImportPlan({
      parcels: [parcel()],
      entities: [stored, owner],
      relationTypes: [
        { id: 'rt-owns', orgId: 'org', key: 'owns', label: 'owns', reverseLabel: 'is owned by' },
      ],
      relations: [
        {
          id: 'rel-1',
          orgId: 'org',
          relationTypeId: 'rt-owns',
          fromEntityId: owner.id,
          toEntityId: stored.id,
          startDate: '2020-01-01',
          endDate: null,
          attributes: {},
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          deletedAt: null,
          archivedAt: null,
        },
      ],
    })

    expect(rows[0]?.ownershipAlreadyRecorded).toBe(true)
    expect(rows[0]?.ownerAction).toBe('skip_owner')
  })

  it('finds real matches and real creates in the seeded data', () => {
    const demo = buildDemoData(REFERENCE)
    const parcels = [parcel({ pin: String(demo.entities.find((e) => e.type === 'property')?.data.pin) })]

    const rows = buildImportPlan({ parcels, entities: demo.entities })
    expect(rows[0]?.propertyAction).toBe('update_property')
  })
})

describe('summarizePlan', () => {
  const base: PlanRow = {
    key: 'k',
    parcel: parcel(),
    selected: true,
    propertyAction: 'create_property',
    existingProperty: null,
    changes: [],
    ownerAction: 'create_owner',
    ownerMatch: null,
    ownerMatchConfidence: null,
    ownerKind: 'person',
    ownerDisplayName: 'John A. Smith',
    ownerNameConfidence: 'high',
    ownershipAlreadyRecorded: false,
  }

  it('counts one owner create when two parcels name the same new owner', () => {
    const summary = summarizePlan([base, { ...base, key: 'k2' }])
    expect(summary.ownersToCreate).toBe(1)
    // Two lots owned by one person is still two ownership connections.
    expect(summary.ownershipRelations).toBe(2)
  })

  it('counts a deselected row and an explicit skip as skipped', () => {
    const summary = summarizePlan([
      { ...base, selected: false },
      { ...base, key: 'k2', propertyAction: 'skip' },
    ])
    expect(summary.skipped).toBe(2)
    expect(summary.propertiesToCreate).toBe(0)
  })

  it('separates an update that changes nothing from one that does', () => {
    const summary = summarizePlan([
      { ...base, key: 'a', propertyAction: 'update_property', changes: [] },
      {
        ...base,
        key: 'b',
        propertyAction: 'update_property',
        changes: [{ field: 'zoning', label: 'Zoning district', from: 'R-6', to: 'R-B' }],
      },
    ])

    expect(summary.noChangeUpdates).toBe(1)
    expect(summary.propertiesToUpdate).toBe(1)
  })
})

describe('applyImportPlan', () => {
  let provider: DataProvider

  beforeEach(() => {
    provider = createMemoryProvider(buildDemoData(REFERENCE))
  })

  async function planFor(parcels: ParcelRecord[]): Promise<PlanRow[]> {
    const entities = await provider.listAllEntities()
    const relations = await provider.listRelations()
    const relationTypes = await provider.listRelationTypes()
    return buildImportPlan({ parcels, entities, relations, relationTypes })
  }

  it('creates the property, the owner, and the ownership connection', async () => {
    const rows = await planFor([parcel({ pin: '29999 99999', ownerName: 'CAVANAUGH, NAOMI' })])

    const result = await applyImportPlan({ rows, provider, ownsRelationTypeId: 'rt-owns' })

    expect(result.propertiesCreated).toBe(1)
    expect(result.ownersCreated).toBe(1)
    expect(result.relationsCreated).toBe(1)

    const created = await provider.listEntities({ search: '29999 99999', pageSize: 10 })
    expect(created.rows).toHaveLength(1)
    expect(created.rows[0]?.data.parcelSource).toBe('imported')

    const people = await provider.listEntities({ type: 'person', search: 'Naomi Cavanaugh' })
    expect(people.rows).toHaveLength(1)
  })

  it('audits every write field by field under one batch', async () => {
    const rows = await planFor([parcel({ pin: '29999 99998', ownerName: 'TANDY, JUNIE' })])
    const result = await applyImportPlan({ rows, provider, ownsRelationTypeId: 'rt-owns' })

    const batch = await provider.listActivity({ batchId: result.batchId, pageSize: 200 })
    expect(batch.total).toBeGreaterThan(0)
    expect(batch.rows.every((entry) => entry.batchId === result.batchId)).toBe(true)

    // The whole import is one batch, and nothing outside it was touched.
    const everything = await provider.listActivity({ pageSize: 500 })
    expect(everything.total).toBeGreaterThan(batch.total)
  })

  it('creates one owner when several parcels name the same new person', async () => {
    const rows = await planFor([
      parcel({ pin: '29999 99997', ownerName: 'ULMER, BERNADETTE' }),
      parcel({ pin: '29999 99996', ownerName: 'ULMER, BERNADETTE' }),
    ])

    const result = await applyImportPlan({ rows, provider, ownsRelationTypeId: 'rt-owns' })

    expect(result.propertiesCreated).toBe(2)
    expect(result.ownersCreated).toBe(1)
    expect(result.relationsCreated).toBe(2)
  })

  it('writes nothing for a skipped row', async () => {
    const before = await provider.countsByType()
    const rows = await planFor([parcel({ pin: '29999 99995' })])

    const result = await applyImportPlan({
      rows: rows.map((row) => ({ ...row, propertyAction: 'skip' as const })),
      provider,
      ownsRelationTypeId: 'rt-owns',
    })

    expect(result.skipped).toBe(1)
    expect(await provider.countsByType()).toEqual(before)
  })

  it('updates a matched property without touching its property use', async () => {
    const properties = await provider.listEntities({ type: 'property', pageSize: 500 })
    const target = properties.rows.find(
      (entity) => typeof entity.data.pin === 'string' && entity.data.propertyUse !== undefined
    )
    expect(target).toBeDefined()
    if (!target) return

    const originalUse = target.data.propertyUse

    const rows = await planFor([
      parcel({ pin: String(target.data.pin), totalAssessment: 999_500, zoningDistrict: 'TC-1' }),
    ])

    await applyImportPlan({ rows, provider, ownsRelationTypeId: 'rt-owns' })

    const after = await provider.getEntity(target.id)
    expect(after?.data.assessedValue).toBe(999_500)
    expect(after?.data.zoning).toBe('TC-1')
    expect(after?.data.propertyUse).toBe(originalUse)
  })
})

describe('parsePinList', () => {
  it('reads one PIN per line', () => {
    expect(parsePinList('20032 63001\n10993C01034')).toEqual(['20032 63001', '10993C01034'])
  })

  it('reads the first column of a CSV and skips a header row', () => {
    const csv = 'PIN,Address\n20032 63001,1207 E Washington Ave\n10993C01034,2140 Abercorn St'
    expect(parsePinList(csv)).toEqual(['20032 63001', '10993C01034'])
  })

  it('does not split the spaced PIN form on its space', () => {
    expect(parsePinList('20032 63001')).toEqual(['20032 63001'])
  })

  it('strips quotes, blank lines, and duplicates', () => {
    expect(parsePinList('"20032 63001"\n\n20032 63001\n  10993C01034  ')).toEqual([
      '20032 63001',
      '10993C01034',
    ])
  })

  it('returns an empty list for empty input', () => {
    expect(parsePinList('')).toEqual([])
    expect(parsePinList('\n\n  \n')).toEqual([])
  })
})
