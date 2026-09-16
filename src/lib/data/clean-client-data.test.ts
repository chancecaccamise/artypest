import { describe, expect, it } from 'vitest'

import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'

import { buildDemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'

function parcel(pin: string, situsAddress: string, ownerName: string): ParcelLayerRecord {
  return {
    pin,
    situsAddress,
    ownerName,
    ownerName2: null,
    ownerMailingAddress: { street: situsAddress, city: 'SAVANNAH', state: 'GA', zip: '31401' },
    acreage: 0.12,
    zoningDistrict: 'TN-2',
    propertyUseCode: 'C1',
    fairMarketValue: 300000,
    totalAssessment: 120000,
    yearBuilt: 1920,
    legalDescription: 'CLEAN CLIENT DATA TEST',
    municipalityCode: '020',
    dateUpdated: '2026-01-01',
    lastSaleDate: null,
    lastSalePrice: null,
    saleQualityCode: null,
    neighborhood: 'Thomas Square',
  }
}

const clean = buildDemoData(
  new Date('2026-09-16T00:00:00Z'),
  [
    parcel('20065 12006', '2011 BULL ST', '2011 BULL LLC'),
    parcel('20076 15006', '644 E 44TH ST', 'YATES & SHEPHARD JOSHUA W & WHITNEY G'),
  ],
  { includeTemporaryData: false }
)

describe('clean client dataset', () => {
  it('contains only supplied contacts, county parcels, and the real association', () => {
    const byType = (type: (typeof clean.entities)[number]['type']) =>
      clean.entities.filter((entity) => entity.type === type)

    expect(clean.org.name).toBe('Thomas Square Neighborhood Association')
    expect(byType('person')).toHaveLength(15)
    expect(byType('business')).toHaveLength(14)
    expect(byType('property')).toHaveLength(2)
    expect(byType('association').map((entity) => entity.name)).toEqual([
      'Thomas Square Neighborhood Association',
    ])
    expect(byType('record')).toEqual([])
    expect(byType('document')).toEqual([])
    expect(byType('asset')).toEqual([])
  })

  it('removes generated people, businesses, committees, and updates', () => {
    const names = clean.entities.map((entity) => entity.name)
    expect(names).not.toContain('Marguerite Hollis')
    expect(names).not.toContain('Tidewater Landscaping LLC')
    expect(names).not.toContain('Architectural Review Committee')
    expect(clean.auditEntries).toEqual([])
    expect(clean.users).toEqual([])
  })

  it('keeps only relationships whose records survived the cleanup', () => {
    const entityIds = new Set(clean.entities.map((entity) => entity.id))
    expect(
      clean.relations.every(
        (relation) => entityIds.has(relation.fromEntityId) && entityIds.has(relation.toEntityId)
      )
    ).toBe(true)
    expect(clean.relations).toHaveLength(16)
  })

  it('starts the activity and work logs empty', async () => {
    const provider = createMemoryProvider(clean)
    await expect(provider.listActivity({ pageSize: 100 })).resolves.toMatchObject({
      rows: [],
      total: 0,
    })
  })
})
