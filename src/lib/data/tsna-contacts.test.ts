import { describe, expect, it } from 'vitest'

import { registerParcelGeometry } from '@/lib/geo'
import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'
import { relationKey, resolveGraph } from '@/lib/insights'

import { buildDemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'

const REFERENCE = new Date('2026-09-16T00:00:00.000Z')

function parcel(pin: string, situsAddress: string, ownerName: string): ParcelLayerRecord {
  return {
    pin,
    situsAddress,
    ownerName,
    ownerName2: null,
    ownerMailingAddress: { street: situsAddress, city: 'SAVANNAH', state: 'GA', zip: '31401' },
    acreage: 0.14,
    zoningDistrict: 'TN-2',
    propertyUseCode: 'R3',
    fairMarketValue: 380000,
    totalAssessment: 152000,
    yearBuilt: 1921,
    legalDescription: 'TSNA CONTACT TEST',
    municipalityCode: '020',
    dateUpdated: '2025-05-06',
    lastSaleDate: null,
    lastSalePrice: null,
    saleQualityCode: null,
    neighborhood: 'Thomas Square',
  }
}

const CONTACT_PARCELS = [
  parcel('20065 12006', '2011 BULL ST', '2011 BULL LLC'),
  parcel('20076 15006', '644 E 44TH ST', 'YATES & SHEPHARD JOSHUA W & WHITNEY G'),
  parcel('20075 15001', '2430 HABERSHAM ST', 'HOUSEMADE LLC'),
  parcel('20065 04002', '107 E 35TH ST', 'GALLOWAY KEITH K'),
]

describe('TSNA supplied contacts', () => {
  const snapshot = buildDemoData(REFERENCE, CONTACT_PARCELS)
  const graph = resolveGraph(snapshot)
  const active = snapshot.entities.filter(
    (entity) => entity.archivedAt === null && entity.deletedAt === null
  )

  it('replaces generated directory entries with the supplied people and businesses', () => {
    const people = active.filter((entity) => entity.type === 'person')
    const businesses = active.filter((entity) => entity.type === 'business')

    expect(people).toHaveLength(15)
    expect(businesses).toHaveLength(14)
    expect(people.map((person) => person.name)).toContain('Kay Heritage')
    expect(businesses.map((business) => business.name)).toContain('Green Truck Pub')
    expect(active.map((entity) => entity.name)).not.toContain('Tidewater Landscaping LLC')
  })

  it('connects each business to its real contact and retains website details', () => {
    const kay = active.find((entity) => entity.name === 'Kay Heritage')
    const bigBon = active.find((entity) => entity.name === 'Big Bon')
    expect(bigBon?.data.website).toBe('https://bigbonfamily.com')

    const connection = snapshot.relations.find(
      (relation) => relation.fromEntityId === kay?.id && relation.toEntityId === bigBon?.id
    )
    expect(connection ? relationKey(connection, graph) : null).toBe('employed_by')
  })

  it('uses association links for business locations and corroborated ownership for people', () => {
    const greenTruck = active.find((entity) => entity.name === 'Green Truck Pub')
    const whitney = active.find((entity) => entity.name === 'Whitney Shephard')
    const businessProperty = active.find((entity) => entity.name === '2430 HABERSHAM ST')
    const homeProperty = active.find((entity) => entity.name === '644 E 44TH ST')

    const businessLink = snapshot.relations.find(
      (relation) =>
        relation.fromEntityId === greenTruck?.id && relation.toEntityId === businessProperty?.id
    )
    const ownership = snapshot.relations.find(
      (relation) =>
        relation.fromEntityId === whitney?.id && relation.toEntityId === homeProperty?.id
    )

    expect(businessLink ? relationKey(businessLink, graph) : null).toBe('related_to')
    expect(ownership ? relationKey(ownership, graph) : null).toBe('owns')
  })

  it('places linked contacts when the harvested parcel geometry loads', async () => {
    registerParcelGeometry({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { pin: '20075 15001' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-81.095, 32.04],
                [-81.094, 32.04],
                [-81.094, 32.041],
                [-81.095, 32.041],
                [-81.095, 32.04],
              ],
            ],
          },
        },
      ],
    })

    const provider = createMemoryProvider(snapshot)
    const greenTruck = active.find((entity) => entity.name === 'Green Truck Pub')
    if (!greenTruck) throw new Error('Green Truck Pub fixture is missing')

    const location = await provider.resolveLocation(greenTruck.id)
    expect(location).toMatchObject({
      source: 'related',
      viaEntityName: '2430 HABERSHAM ST',
      pin: '20075 15001',
    })
  })
})
