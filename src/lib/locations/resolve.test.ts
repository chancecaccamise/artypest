import { describe, expect, it } from 'vitest'

import { centroidForPin, PARCELS } from '@/lib/geo'
import { resolveAllLocations, resolveLocation, type ResolveContext } from './resolve'
import { buildDemoData } from '@/lib/data/fixtures'
import type { Entity, Relation, RelationType } from '@/lib/data/types'
import { geocodeSync } from '@/lib/geocoding'
import { resolveGraph } from '@/lib/insights'

const TODAY = new Date('2026-08-01T00:00:00.000Z')

/** A PIN that really has geometry, so tests are not asserting against nothing. */
const PLATTED_PIN = PARCELS.features[0]?.properties.pin ?? ''

const TYPES: RelationType[] = [
  { id: 'rt-owns', orgId: 'o', key: 'owns', label: 'owns', reverseLabel: 'is owned by' },
  {
    id: 'rt-resides-at',
    orgId: 'o',
    key: 'resides_at',
    label: 'resides at',
    reverseLabel: 'is home to',
  },
  {
    id: 'rt-related-to',
    orgId: 'o',
    key: 'related_to',
    label: 'is related to',
    reverseLabel: 'is related to',
  },
  {
    id: 'rt-governs',
    orgId: 'o',
    key: 'governs',
    label: 'governs',
    reverseLabel: 'is governed by',
  },
  {
    id: 'rt-adjacent-to',
    orgId: 'o',
    key: 'adjacent_to',
    label: 'is adjacent to',
    reverseLabel: 'is adjacent to',
  },
  {
    id: 'rt-references',
    orgId: 'o',
    key: 'references',
    label: 'references',
    reverseLabel: 'is referenced by',
  },
]

function entity(
  id: string,
  type: Entity['type'],
  name: string,
  data: Entity['data'] = {},
  lifecycle: Partial<Pick<Entity, 'archivedAt' | 'deletedAt'>> = {}
): Entity {
  return {
    id,
    orgId: 'o',
    type,
    name,
    data,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: lifecycle.deletedAt ?? null,
    archivedAt: lifecycle.archivedAt ?? null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

function relation(
  id: string,
  relationTypeId: string,
  fromEntityId: string,
  toEntityId: string,
  extra: Partial<Relation> = {}
): Relation {
  return {
    id,
    orgId: 'o',
    relationTypeId,
    fromEntityId,
    toEntityId,
    startDate: null,
    endDate: null,
    attributes: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    ...extra,
  }
}

function context(entities: Entity[], relations: Relation[] = []): ResolveContext {
  return {
    graph: resolveGraph({ entities, relations, relationTypes: TYPES }),
    centroidForPin,
    geocode: geocodeSync,
    today: TODAY,
  }
}

describe('manual placement', () => {
  it('wins over everything else, in either stored shape', () => {
    const asPair = entity('p1', 'property', 'Hand placed', {
      pin: PLATTED_PIN,
      location: [-81.09, 32.041],
    })
    const asObject = entity('p2', 'property', 'Hand placed too', {
      pin: PLATTED_PIN,
      location: { lng: -81.09, lat: 32.041 },
    })

    for (const subject of [asPair, asObject]) {
      const resolved = resolveLocation(subject, context([subject]))
      expect(resolved?.source).toBe('manual')
      expect(resolved?.precision).toBe('exact')
      expect(resolved?.point).toEqual([-81.09, 32.041])
    }
  })

  it('ignores a malformed coordinate rather than half-reading it', () => {
    const bad = [
      entity('a', 'property', 'A', { location: [-81.09] }),
      entity('b', 'property', 'B', { location: ['-81.09', '32.04'] }),
      entity('c', 'property', 'C', { location: { lng: -81.09 } }),
      entity('d', 'property', 'D', { location: [-999, 32.04] }),
      entity('e', 'property', 'E', { location: 'somewhere' }),
    ]

    for (const subject of bad) {
      expect(resolveLocation(subject, context([subject]))?.source).not.toBe('manual')
    }
  })
})

describe('property', () => {
  it('resolves to the parcel centroid when geometry is on file', () => {
    const lot = entity('lot', 'property', 'A lot', { pin: PLATTED_PIN })
    const resolved = resolveLocation(lot, context([lot]))

    expect(resolved?.source).toBe('parcel')
    expect(resolved?.precision).toBe('exact')
    expect(resolved?.pin).toBe(PLATTED_PIN)
    expect(resolved?.point).toEqual(centroidForPin(PLATTED_PIN))
  })

  it('falls back to geocoding the situs address when there is no parcel', () => {
    const lot = entity('lot', 'property', 'Unplatted', {
      pin: '29999 99999',
      situsAddress: '3135 Robertson Ave, Savannah, GA 31404',
    })
    const resolved = resolveLocation(lot, context([lot]))

    expect(resolved?.source).toBe('geocoded')
    expect(resolved?.precision).toBe('derived')
  })

  it('is unplaced when neither the parcel nor the address is known', () => {
    const lot = entity('lot', 'property', 'Nowhere', { pin: null, situsAddress: '9 Nowhere Ln' })
    expect(resolveLocation(lot, context([lot]))).toBeNull()
  })
})

describe('person', () => {
  const lot = entity('lot', 'property', '1 Platted St', { pin: PLATTED_PIN })

  it('borrows from the lot they live at, and says so', () => {
    const person = entity('per', 'person', 'A Resident')
    const ctx = context([person, lot], [relation('r', 'rt-resides-at', 'per', 'lot')])
    const resolved = resolveLocation(person, ctx)

    expect(resolved?.source).toBe('residence')
    expect(resolved?.precision).toBe('derived')
    expect(resolved?.viaEntityId).toBe('lot')
    expect(resolved?.explanation).toBe('Lives at 1 Platted St')
    expect(resolved?.point).toEqual(centroidForPin(PLATTED_PIN))
  })

  it('prefers residence over ownership when both exist', () => {
    const other = entity('lot2', 'property', '2 Platted St', {
      pin: PARCELS.features[1]?.properties.pin,
    })
    const person = entity('per', 'person', 'Owner elsewhere')
    const ctx = context(
      [person, lot, other],
      [relation('r1', 'rt-owns', 'per', 'lot2'), relation('r2', 'rt-resides-at', 'per', 'lot')]
    )

    expect(resolveLocation(person, ctx)?.viaEntityId).toBe('lot')
  })

  it('falls back to a lot they own when they live nowhere on file', () => {
    const person = entity('per', 'person', 'Absent owner')
    const ctx = context([person, lot], [relation('r', 'rt-owns', 'per', 'lot')])

    expect(resolveLocation(person, ctx)?.source).toBe('ownership')
  })

  it('borrows from a property they are associated with', () => {
    const person = entity('per', 'person', 'Associated resident')
    const ctx = context([person, lot], [relation('r', 'rt-related-to', 'per', 'lot')])

    expect(resolveLocation(person, ctx)?.source).toBe('related')
    expect(resolveLocation(person, ctx)?.viaEntityId).toBe('lot')
  })

  it('does not borrow from a lot they sold', () => {
    const person = entity('per', 'person', 'Prior owner')
    const ctx = context(
      [person, lot],
      [relation('r', 'rt-owns', 'per', 'lot', { endDate: '2026-03-01' })]
    )

    expect(resolveLocation(person, ctx)).toBeNull()
  })

  it('does not borrow from an archived lot', () => {
    const archived = entity(
      'lot',
      'property',
      'Archived lot',
      { pin: PLATTED_PIN },
      {
        archivedAt: '2026-01-01T00:00:00.000Z',
      }
    )
    const person = entity('per', 'person', 'A Resident')
    const ctx = context([person, archived], [relation('r', 'rt-resides-at', 'per', 'lot')])

    expect(resolveLocation(person, ctx)).toBeNull()
  })
})

describe('business', () => {
  it('is at its office address, not at a lot it holds title to', () => {
    const lot = entity('lot', 'property', 'A lot', { pin: PLATTED_PIN })
    const vendor = entity('biz', 'business', 'A Vendor LLC', {
      mailingAddress: '3135 Robertson Ave, Savannah, GA 31404',
    })
    const ctx = context([vendor, lot], [relation('r', 'rt-owns', 'biz', 'lot')])
    const resolved = resolveLocation(vendor, ctx)

    expect(resolved?.source).toBe('geocoded')
    expect(resolved?.point).not.toEqual(centroidForPin(PLATTED_PIN))
  })

  it('falls back to a lot it owns when the office address is unknown', () => {
    const lot = entity('lot', 'property', 'A lot', { pin: PLATTED_PIN })
    const holding = entity('biz', 'business', 'Holdings LLC', {
      mailingAddress: '4 Nowhere Plaza, Atlanta, GA 30309',
    })
    const ctx = context([holding, lot], [relation('r', 'rt-owns', 'biz', 'lot')])

    expect(resolveLocation(holding, ctx)?.source).toBe('ownership')
  })

  it('falls back to an associated property when the office address is unknown', () => {
    const lot = entity('lot', 'property', 'A lot', { pin: PLATTED_PIN })
    const business = entity('biz', 'business', 'Property service')
    const ctx = context([business, lot], [relation('r', 'rt-related-to', 'biz', 'lot')])

    expect(resolveLocation(business, ctx)?.source).toBe('related')
    expect(resolveLocation(business, ctx)?.viaEntityId).toBe('lot')
  })

  it('is unplaced when neither is known', () => {
    const holding = entity('biz', 'business', 'Holdings LLC', {
      mailingAddress: '4 Nowhere Plaza, Atlanta, GA 30309',
    })
    expect(resolveLocation(holding, context([holding]))).toBeNull()
  })
})

describe('association, asset, record, and document', () => {
  const lotA = entity('lotA', 'property', 'Lot A', { pin: PARCELS.features[2]?.properties.pin })
  const lotB = entity('lotB', 'property', 'Lot B', { pin: PARCELS.features[3]?.properties.pin })

  it('places an association at the centre of the lots it governs', () => {
    const hoa = entity('hoa', 'association', 'The HOA')
    const ctx = context(
      [hoa, lotA, lotB],
      [relation('r1', 'rt-governs', 'hoa', 'lotA'), relation('r2', 'rt-governs', 'hoa', 'lotB')]
    )
    const resolved = resolveLocation(hoa, ctx)

    const a = centroidForPin(lotA.data.pin as string)
    const b = centroidForPin(lotB.data.pin as string)
    expect(resolved?.source).toBe('governed')
    expect(resolved?.point[0]).toBeCloseTo(((a?.[0] ?? 0) + (b?.[0] ?? 0)) / 2, 6)
  })

  it('places an asset on the parcel it sits beside', () => {
    const asset = entity('ast', 'asset', 'Playground')
    const ctx = context([asset, lotA], [relation('r', 'rt-adjacent-to', 'ast', 'lotA')])
    const resolved = resolveLocation(asset, ctx)

    expect(resolved?.source).toBe('related')
    expect(resolved?.explanation).toBe('On Lot A')
  })

  it('places a record on the lot it was filed against', () => {
    const record = entity('rec', 'record', 'A violation', { propertyId: 'lotA' })
    const resolved = resolveLocation(record, context([record, lotA]))

    expect(resolved?.source).toBe('related')
    expect(resolved?.viaEntityId).toBe('lotA')
  })

  it('will not chain a document through a record onto a lot', () => {
    const record = entity('rec', 'record', 'A violation', { propertyId: 'lotA' })
    const doc = entity('doc', 'document', 'Covenants')
    const ctx = context([doc, record, lotA], [relation('r', 'rt-references', 'rec', 'doc')])

    /*
      That would be two borrowings deep: the document takes from the record,
      which itself took from the lot. Putting the 1994 covenants on a lot
      because a violation happened to cite them is exactly the location nobody
      can explain that the one-hop rule exists to prevent.
    */
    expect(resolveLocation(doc, ctx)).toBeNull()
  })

  it('does place a document through a record that was placed by hand', () => {
    // One borrowing from something exact, which is inside the rule.
    const record = entity('rec', 'record', 'A site visit', { location: [-81.094, 32.0425] })
    const doc = entity('doc', 'document', 'Site photographs')
    const ctx = context([doc, record], [relation('r', 'rt-references', 'rec', 'doc')])

    const resolved = resolveLocation(doc, ctx)
    expect(resolved?.source).toBe('related')
    expect(resolved?.point).toEqual([-81.094, 32.0425])
  })
})

describe('resolveAllLocations, against the seeded data', () => {
  const demo = buildDemoData(TODAY)
  const ctx = context(demo.entities, demo.relations)
  const index = resolveAllLocations({
    ...ctx,
    graph: resolveGraph({
      entities: demo.entities,
      relations: demo.relations,
      relationTypes: demo.relationTypes,
    }),
  })

  it('places every platted lot from its parcel boundary', () => {
    const platted = demo.entities.filter(
      (candidate) => candidate.type === 'property' && centroidForPin(candidate.data.pin as string)
    )
    expect(platted.length).toBe(PARCELS.features.length)
    expect(platted.every((lot) => index.byEntity.get(lot.id)?.source === 'parcel')).toBe(true)
  })

  it('leaves supplied contacts unplaced until the harvested geometry loads', () => {
    const residents = demo.entities.filter(
      (candidate) => candidate.type === 'person' && candidate.archivedAt === null
    )
    expect(residents.length).toBeGreaterThan(0)
    expect(residents.every((person) => !index.byEntity.has(person.id))).toBe(true)
  })

  it('leaves some records unplaced, which is a normal state', () => {
    expect(index.unplaced.length).toBeGreaterThan(0)
    // Nothing unplaced also has a location, which would be a contradiction.
    expect(index.unplaced.every((row) => !index.byEntity.has(row.id))).toBe(true)
  })

  it('never reports an exact location it did not derive from geometry or a hand placement', () => {
    for (const resolved of index.byEntity.values()) {
      if (resolved.precision === 'exact') {
        expect(['manual', 'parcel']).toContain(resolved.source)
      } else {
        expect(['manual', 'parcel']).not.toContain(resolved.source)
      }
    }
  })

  it('always explains a borrowed location', () => {
    for (const resolved of index.byEntity.values()) {
      expect(resolved.explanation.length).toBeGreaterThan(0)
      if (resolved.viaEntityId) {
        expect(resolved.explanation).toContain(resolved.viaEntityName ?? '')
      }
    }
  })

  it('indexes properties by PIN for the plat to join on', () => {
    expect(index.propertyByPin.size).toBeGreaterThanOrEqual(PARCELS.features.length)
  })
})
