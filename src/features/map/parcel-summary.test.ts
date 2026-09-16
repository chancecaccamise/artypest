import { describe, expect, it } from 'vitest'

import { buildDemoData } from '@/lib/data/fixtures'
import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'
import { resolveGraph } from '@/lib/insights'

import { parcelForLocatedRecord, parcelHoverLabel, recordsAtParcel } from './parcel-summary'

function parcel(pin: string, situsAddress: string, ownerName: string): ParcelLayerRecord {
  return {
    pin,
    situsAddress,
    ownerName,
    ownerName2: null,
    ownerMailingAddress: { street: situsAddress, city: 'SAVANNAH', state: 'GA', zip: '31401' },
    acreage: 0.1,
    zoningDistrict: 'TN-2',
    propertyUseCode: 'C1',
    fairMarketValue: 300000,
    totalAssessment: 120000,
    yearBuilt: 1920,
    legalDescription: 'PARCEL SUMMARY TEST',
    municipalityCode: '020',
    dateUpdated: '2026-01-01',
    lastSaleDate: null,
    lastSalePrice: null,
    saleQualityCode: null,
    neighborhood: 'Thomas Square',
  }
}

const snapshot = buildDemoData(new Date('2026-09-16T00:00:00Z'), [
  parcel('20075 15001', '2430 HABERSHAM ST', 'HOUSEMADE LLC'),
  parcel('20065 04002', '107 E 35TH ST', 'GALLOWAY KEITH K'),
  parcel('20065 99999', '301 E 31ST ST', 'GENSER GARRY'),
])
const graph = resolveGraph(snapshot)

function propertyNamed(name: string) {
  const property = graph.entities.find(
    (entity) => entity.type === 'property' && entity.name === name
  )
  if (!property) throw new Error(`Missing property ${name}`)
  return property
}

describe('parcel summaries', () => {
  it('shows a business and its supplied person on hover', () => {
    expect(parcelHoverLabel(propertyNamed('2430 HABERSHAM ST'), graph)).toBe(
      'Green Truck Pub — Whitney Shephard'
    )
  })

  it('prefers an explicit individual owner alongside the business', () => {
    expect(parcelHoverLabel(propertyNamed('107 E 35TH ST'), graph)).toBe(
      'The Galloway House — Keith Galloway'
    )
  })

  it('shows only the individual when no business is at the parcel', () => {
    expect(parcelHoverLabel(propertyNamed('301 E 31ST ST'), graph)).toBe('Garry Genser')
  })

  it('includes the business contact in the parcel panel records', () => {
    const names = recordsAtParcel(propertyNamed('2430 HABERSHAM ST'), graph).map(
      (row) => row.entity.name
    )
    expect(names).toEqual(['Green Truck Pub', 'Whitney Shephard'])
  })

  it('turns a placed person or business dot into its parcel selection', () => {
    const property = propertyNamed('2430 HABERSHAM ST')
    const business = graph.entities.find((entity) => entity.name === 'Green Truck Pub')
    if (!business) throw new Error('Missing Green Truck Pub')

    expect(
      parcelForLocatedRecord(business.id, {
        byEntity: new Map([
          [
            business.id,
            {
              entityId: business.id,
              point: [-81.09, 32.04],
              source: 'related',
              precision: 'derived',
              viaEntityId: property.id,
              viaEntityName: property.name,
              explanation: `Associated with ${property.name}`,
              pin: '20075 15001',
            },
          ],
        ]),
        propertyByPin: new Map([['20075 15001', property]]),
        unplaced: [],
      })
    ).toBe(property)
  })
})
