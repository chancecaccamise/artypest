import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/data/types'
import { addressKey, duplicatesOfProperty, findDuplicateProperties } from './duplicates'

function property(id: string, name: string, data: Record<string, unknown> = {}): Entity {
  return {
    id,
    orgId: 'org',
    type: 'property',
    name,
    data,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

const COUNTY = property('county', '104 E 40TH ST', { pin: '20065 38013' })
const CONDO = property('condo', '300 E 41ST ST', { pin: '20065 40001' })

describe('addressKey', () => {
  it('reads a typed address and the county situs address as the same', () => {
    expect(addressKey('104 E. 40th Street')).toBe(addressKey('104 E 40TH ST'))
    expect(addressKey('104 East 40th St')).toBe(addressKey('104 E 40TH ST'))
  })

  it('keeps different house numbers apart', () => {
    expect(addressKey('104 E 40th St')).not.toBe(addressKey('1040 E 40th St'))
  })
})

describe('findDuplicateProperties', () => {
  it('finds a lot by parcel number whatever its spacing', () => {
    const matches = findDuplicateProperties({ name: 'Pottery studio', pin: '20065  38013' }, [
      COUNTY,
    ])
    expect(matches).toEqual([{ entity: COUNTY, by: 'pin' }])
  })

  it('finds a lot by address when no parcel number was typed', () => {
    const matches = findDuplicateProperties({ name: '104 E. 40th Street', pin: '' }, [COUNTY])
    expect(matches).toEqual([{ entity: COUNTY, by: 'address' }])
  })

  it('never counts a record as its own duplicate', () => {
    expect(findDuplicateProperties({ id: 'county', name: COUNTY.name, pin: '20065 38013' }, [COUNTY]))
      .toEqual([])
  })

  it('ignores deleted records and other kinds', () => {
    const deleted = { ...COUNTY, deletedAt: '2026-02-01T00:00:00.000Z' }
    const business = { ...COUNTY, id: 'b', type: 'business' as const }
    expect(findDuplicateProperties({ name: COUNTY.name, pin: '20065 38013' }, [deleted, business]))
      .toEqual([])
  })
})

describe('duplicatesOfProperty', () => {
  it('flags a second record with the same parcel number', () => {
    const typedIn = property('typed', '104 E 40th St', { pin: '20065 38013' })
    expect(duplicatesOfProperty(typedIn, [COUNTY, CONDO, typedIn])).toEqual([COUNTY])
  })

  it('does not flag a shared address alone, which condominium units have', () => {
    const unit = property('unit', '300 E 41ST ST', { pin: '20065 40002' })
    expect(duplicatesOfProperty(unit, [CONDO, unit])).toEqual([])
  })
})
