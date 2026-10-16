import { describe, expect, it } from 'vitest'

import { DIRECTORY_CONFIGS } from '@/features/directory/config'
import type { Entity } from '@/lib/data/types'
import { NAICS_SECTORS, naicsSector } from './naics'

function business(category: string | null): Entity {
  return {
    id: 'ent-business',
    orgId: 'org',
    type: 'business',
    name: 'Starland Yard',
    data: { businessCategory: category },
    folderId: null,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

describe('NAICS sectors', () => {
  it('has the twenty sectors, each code once', () => {
    expect(NAICS_SECTORS).toHaveLength(20)
    expect(new Set(NAICS_SECTORS.map((sector) => sector.value)).size).toBe(20)
  })

  it('finds a sector by its stored code, ranges included', () => {
    expect(naicsSector('72')?.label).toBe('Accommodation and Food Services')
    expect(naicsSector('31-33')?.label).toBe('Manufacturing')
    expect(naicsSector('member_business')).toBeUndefined()
  })

  it('is what a business is categorised by', () => {
    const field = DIRECTORY_CONFIGS.business.fields.find((item) => item.key === 'businessCategory')
    expect(field?.options).toHaveLength(20)
  })

  it('shows the sector as a chip, and an older category as it was', () => {
    const chips = DIRECTORY_CONFIGS.business.chips
    expect(chips(business('72'))).toContainEqual({
      prefix: 'NAICS',
      value: '72',
      title: 'Accommodation and Food Services',
    })
    expect(chips(business('member_business'))).toContainEqual({ value: 'Member business' })
  })
})
