import { describe, expect, it } from 'vitest'

import { buildDemoData } from '@/lib/data/fixtures'
import { connectionReadings, readingFor, readingLabel } from './readings'

const TYPES = buildDemoData(new Date('2026-10-16T00:00:00.000Z')).relationTypes

describe('connection readings', () => {
  it('offers the board\'s list first, in the board\'s order', () => {
    const main = connectionReadings(TYPES)
      .filter((reading) => reading.group === 'main')
      .map((reading) => readingLabel(reading.label))

    expect(main).toEqual([
      'Owns',
      'Resides at',
      'Rents property',
      'Rents from',
      'Is a member of',
      'Is an executive of',
      'Governs',
      'Employs',
      'Is employed by',
      'Is related to',
      'Is a vendor for',
      'Purchases from',
    ])
  })

  it('stores "employs" with the business as the employer', () => {
    const employs = connectionReadings(TYPES).find((reading) => reading.label === 'employs')
    // `employed_by` runs person to business, so "employs" is that type read from the business end.
    expect(employs?.relationTypeId).toBe('rt-employed-by')
    expect(employs?.direction).toBe('in')
  })

  it('offers the other end of each, so a property can say "is owned by"', () => {
    const reverse = connectionReadings(TYPES).filter((reading) => reading.group === 'reverse')
    expect(reverse.map((reading) => reading.label)).toContain('is owned by')
    // Already in the main list, and the same both ways, respectively.
    expect(reverse.map((reading) => reading.label)).not.toContain('employs')
    expect(reverse.map((reading) => reading.label)).not.toContain('is related to')
  })

  it('still offers every other kind, so nothing stored is impossible to choose', () => {
    const labels = connectionReadings(TYPES).map((reading) => reading.label)
    expect(labels).toContain('manages')
    expect(labels).toContain('is managed by')
  })

  it('reads an existing connection from the record being edited', () => {
    const relation = { relationTypeId: 'rt-owns', fromEntityId: 'person', toEntityId: 'lot' }
    expect(readingFor(relation, 'person', TYPES)).toBe('rt-owns:out')
    expect(readingFor(relation, 'lot', TYPES)).toBe('rt-owns:in')
  })
})
