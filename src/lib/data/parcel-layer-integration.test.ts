import { describe, expect, it } from 'vitest'

import { computeOccupancy, computeStats, resolveGraph } from '@/lib/insights'
import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'

import { buildDemoData } from './fixtures'

/*
  What happens to the app when the harvested parcel layer is folded in.

  The parcel layer is not committed, so these build a small stand-in with the
  same shape rather than reading public/parcels/attributes.json. The property
  under test is the arithmetic, not the county's data.
*/

const REFERENCE = new Date('2026-08-17T00:00:00.000Z')

function parcel(pin: string, overrides: Partial<ParcelLayerRecord> = {}): ParcelLayerRecord {
  return {
    pin,
    situsAddress: `${pin.slice(-3)} E GWINNETT ST`,
    ownerName: 'WILLIAMS PATRICK',
    ownerName2: null,
    ownerMailingAddress: { street: '1 E GWINNETT ST', city: 'SAVANNAH', state: 'GA', zip: '31401' },
    acreage: 0.14,
    zoningDistrict: 'TN-2',
    propertyUseCode: 'R3',
    fairMarketValue: 380000,
    totalAssessment: 152000,
    yearBuilt: 1921,
    legalDescription: 'LOT 4 PIERPONT WARD',
    municipalityCode: '020',
    dateUpdated: '2025-05-06',
    lastSaleDate: '2019-04-01',
    lastSalePrice: 385000,
    saleQualityCode: 'Q',
    neighborhood: 'Thomas Square',
    ...overrides,
  }
}

const LAYER: ParcelLayerRecord[] = Array.from({ length: 500 }, (_, index) =>
  parcel(`20099 ${String(index).padStart(5, '0')}`)
)

describe('the harvested parcel layer', () => {
  it('adds a property record for every parcel', () => {
    const withoutLayer = buildDemoData(REFERENCE)
    const withLayer = buildDemoData(REFERENCE, LAYER)

    const count = (data: typeof withLayer) =>
      data.entities.filter((entity) => entity.type === 'property').length

    expect(count(withLayer)).toBe(count(withoutLayer) + LAYER.length)
  })

  it('does not duplicate a lot the association already tracks', () => {
    const base = buildDemoData(REFERENCE)
    const seeded = base.entities.find(
      (entity) => entity.type === 'property' && typeof entity.data.pin === 'string'
    )
    const seededPin = String(seeded?.data.pin)

    const withLayer = buildDemoData(REFERENCE, [parcel(seededPin), ...LAYER])

    const matching = withLayer.entities.filter(
      (entity) => entity.type === 'property' && entity.data.pin === seededPin
    )
    expect(matching).toHaveLength(1)
    // The association's own record wins over the county roll.
    expect(matching[0]?.data.parcelSource).toBe('imported')
    expect(matching[0]?.id).toBe(seeded?.id)
  })

  it('keeps the dashboard describing the association, not the county', () => {
    const withoutLayer = buildDemoData(REFERENCE, [])
    const withLayer = buildDemoData(REFERENCE, LAYER)

    const before = computeStats(resolveGraph(withoutLayer), REFERENCE)
    const after = computeStats(resolveGraph(withLayer), REFERENCE)

    /*
      500 county parcels arrived and the association still has the same lots.
      This is the figure that would otherwise read "548 lots, 4% owner occupied".
    */
    expect(after.lots).toBe(before.lots)
    expect(after.ownerOccupiedPercent).toBe(before.ownerOccupiedPercent)
    // The county layer is present and listed, it just is not the association.
    expect(withLayer.entities.filter((e) => e.type === 'property')).toHaveLength(
      withoutLayer.entities.filter((e) => e.type === 'property').length + LAYER.length
    )
  })

  it('keeps occupancy over the association lots', () => {
    const before = computeOccupancy(resolveGraph(buildDemoData(REFERENCE, [])), REFERENCE)
    const after = computeOccupancy(resolveGraph(buildDemoData(REFERENCE, LAYER)), REFERENCE)

    expect(after.total).toBe(before.total)
    expect(after.counts).toEqual(before.counts)
  })

  it('records association membership as a relation, not a field', () => {
    const data = buildDemoData(REFERENCE, LAYER)
    const memberType = data.relationTypes.find((type) => type.key === 'member_of')
    const propertyMemberships = data.relations.filter(
      (relation) =>
        relation.relationTypeId === memberType?.id &&
        data.entities.find((entity) => entity.id === relation.fromEntityId)?.type === 'property'
    )

    const stats = computeStats(resolveGraph(data), REFERENCE)
    expect(propertyMemberships.length).toBe(stats.lots)
    // Nothing on the record itself says "member". It is the relation.
    const anyProperty = data.entities.find((entity) => entity.type === 'property')
    expect(anyProperty?.data).not.toHaveProperty('hoaMember')
  })

  it('leaves county parcels out of the association without hiding them', () => {
    const data = buildDemoData(REFERENCE, LAYER)
    const properties = data.entities.filter((entity) => entity.type === 'property')

    const countyOnly = properties.filter((entity) => entity.data.countyOwnerName !== undefined)
    expect(countyOnly).toHaveLength(LAYER.length)
    // Listed and searchable: the owner name is on the record even though no
    // person entity was created for them.
    expect(countyOnly[0]?.data.countyOwnerName).toBe('Patrick Williams')
    expect(countyOnly[0]?.data.neighborhood).toBe('Thomas Square')
  })

  it('builds ten thousand lots without falling over', () => {
    const big = Array.from({ length: 10_399 }, (_, index) =>
      parcel(`20098 ${String(index).padStart(5, '0')}`)
    )
    const data = buildDemoData(REFERENCE, big)

    expect(data.entities.filter((entity) => entity.type === 'property').length).toBeGreaterThan(
      10_399
    )
    // The audit feed must not gain an entry per county parcel.
    expect(data.auditEntries.length).toBeLessThan(2_000)
  })
})
