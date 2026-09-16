import { describe, expect, it } from 'vitest'

import { buildDemoData } from './data/fixtures'
import type { Entity, Relation, RelationType } from './data/types'
import {
  computeBoard,
  computeNeedsAttention,
  computeOccupancy,
  computeStats,
  isCurrent,
  needsAttentionFor,
  resolveGraph,
} from './insights'

const TODAY = new Date('2026-07-31T00:00:00.000Z')

function graphFromDemo() {
  const demo = buildDemoData(TODAY)
  return resolveGraph({
    entities: demo.entities,
    relations: demo.relations,
    relationTypes: demo.relationTypes,
  })
}

/* A hand-built graph, so the rules are tested against data the test controls. */
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
    id: 'rt-member-of',
    orgId: 'o',
    key: 'member_of',
    label: 'is a member of',
    reverseLabel: 'has member',
  },
  {
    id: 'rt-vendor-for',
    orgId: 'o',
    key: 'vendor_for',
    label: 'is a vendor for',
    reverseLabel: 'uses vendor',
  },
]

function entity(id: string, type: Entity['type'], name: string, data: Entity['data'] = {}): Entity {
  return {
    id,
    orgId: 'o',
    type,
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

describe('isCurrent', () => {
  it('treats an open-ended relation as current', () => {
    expect(isCurrent(relation('r', 'rt-owns', 'a', 'b'), TODAY)).toBe(true)
  })

  it('excludes a relation that has ended', () => {
    const ended = relation('r', 'rt-owns', 'a', 'b', { endDate: '2026-07-30' })
    expect(isCurrent(ended, TODAY)).toBe(false)
  })

  it('includes a relation ending today', () => {
    const ending = relation('r', 'rt-owns', 'a', 'b', { endDate: '2026-07-31' })
    expect(isCurrent(ending, TODAY)).toBe(true)
  })

  it('excludes a relation that has not started', () => {
    const future = relation('r', 'rt-owns', 'a', 'b', { startDate: '2026-08-01' })
    expect(isCurrent(future, TODAY)).toBe(false)
  })

  it('excludes a soft-deleted relation', () => {
    const deleted = relation('r', 'rt-owns', 'a', 'b', { deletedAt: '2026-05-01T00:00:00.000Z' })
    expect(isCurrent(deleted, TODAY)).toBe(false)
  })
})

describe('computeStats', () => {
  it('counts an owner living in the lot they own as owner-occupied', () => {
    const graph = resolveGraph({
      entities: [
        entity('lot1', 'property', 'Lot 1'),
        entity('lot2', 'property', 'Lot 2'),
        entity('p1', 'person', 'Owner Occupant'),
        entity('p2', 'person', 'Tenant'),
        entity('p3', 'person', 'Absent Owner'),
      ],
      relations: [
        relation('r1', 'rt-owns', 'p1', 'lot1'),
        relation('r2', 'rt-resides-at', 'p1', 'lot1'),
        relation('r3', 'rt-owns', 'p3', 'lot2'),
        relation('r4', 'rt-resides-at', 'p2', 'lot2'),
      ],
      relationTypes: TYPES,
    })

    const stats = computeStats(graph, TODAY)
    expect(stats.lots).toBe(2)
    expect(stats.residents).toBe(2)
    expect(stats.ownerOccupied).toBe(1)
    expect(stats.ownerOccupiedPercent).toBe(50)
  })

  it('reads board seats from member_of with role board, not a separate table', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA', { boardSeats: 7 }),
        entity('p1', 'person', 'President'),
        entity('p2', 'person', 'Treasurer'),
        entity('p3', 'person', 'Ordinary member'),
      ],
      relations: [
        relation('r1', 'rt-member-of', 'p1', 'a1', {
          attributes: { role: 'board', position: 'president' },
        }),
        relation('r2', 'rt-member-of', 'p2', 'a1', {
          attributes: { role: 'board', position: 'treasurer' },
        }),
        // No board role, so this is a member of the association, not a seat.
        relation('r3', 'rt-member-of', 'p3', 'a1', {}),
      ],
      relationTypes: TYPES,
    })

    const stats = computeStats(graph, TODAY)
    expect(stats.boardSeatsFilled).toBe(2)
    expect(stats.boardSeatsTotal).toBe(7)
  })

  it('counts only records whose status is not closed', () => {
    const graph = resolveGraph({
      entities: [
        entity('rec1', 'record', 'Open thing', { status: 'open' }),
        entity('rec2', 'record', 'In review', { status: 'in_review' }),
        entity('rec3', 'record', 'Done', { status: 'closed' }),
      ],
      relations: [],
      relationTypes: TYPES,
    })

    expect(computeStats(graph, TODAY).openItems).toBe(2)
  })

  it('ignores an expired vendor contract when counting active vendors', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA'),
        entity('b1', 'business', 'Current vendor'),
        entity('b2', 'business', 'Former vendor'),
      ],
      relations: [
        relation('r1', 'rt-vendor-for', 'b1', 'a1'),
        relation('r2', 'rt-vendor-for', 'b2', 'a1', { endDate: '2026-01-01' }),
      ],
      relationTypes: TYPES,
    })

    expect(computeStats(graph, TODAY).activeVendors).toBe(1)
  })

  it('agrees with the occupancy breakdown, which sits beside it on the dashboard', () => {
    const graph = graphFromDemo()
    expect(computeStats(graph, TODAY).ownerOccupied).toBe(
      computeOccupancy(graph, TODAY).counts.owner_occupied
    )
  })

  it('produces a coherent picture from the seeded data', () => {
    const stats = computeStats(graphFromDemo(), TODAY)
    expect(stats.lots).toBe(48)
    expect(stats.residents).toBeGreaterThan(0)
    expect(stats.ownerOccupiedPercent).toBeGreaterThan(0)
    expect(stats.ownerOccupiedPercent).toBeLessThanOrEqual(100)
    expect(stats.activeVendors).toBe(7)
    expect(stats.boardSeatsFilled).toBeLessThanOrEqual(stats.boardSeatsTotal)
  })
})

describe('computeNeedsAttention', () => {
  it('flags a vendor contract inside the 90 day window and ignores one outside it', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA'),
        entity('b1', 'business', 'Soon Vendor'),
        entity('b2', 'business', 'Later Vendor'),
      ],
      relations: [
        relation('r1', 'rt-vendor-for', 'b1', 'a1', {
          endDate: '2026-09-15',
          attributes: { contractEndDate: '2026-09-15' },
        }),
        relation('r2', 'rt-vendor-for', 'b2', 'a1', {
          endDate: '2027-06-01',
          attributes: { contractEndDate: '2027-06-01' },
        }),
      ],
      relationTypes: TYPES,
    })

    const items = computeNeedsAttention(graph, TODAY)
    const sources = items.filter((item) => item.source === 'Vendor contract')
    expect(sources).toHaveLength(1)
    expect(sources[0]?.description).toContain('Soon Vendor')
    expect(sources[0]?.urgency).toBe('approaching')
  })

  it('uses a 60 day window for insurance, which is tighter than the contract window', () => {
    const graph = resolveGraph({
      entities: [entity('a1', 'association', 'HOA'), entity('b1', 'business', 'Vendor')],
      relations: [
        relation('r1', 'rt-vendor-for', 'b1', 'a1', {
          // 75 days out: inside the contract window, outside the insurance one.
          attributes: { insuranceExpiresOn: '2026-10-14' },
        }),
      ],
      relationTypes: TYPES,
    })

    expect(computeNeedsAttention(graph, TODAY).some((i) => i.source === 'Vendor insurance')).toBe(
      false
    )
  })

  it('marks a passed date overdue rather than approaching', () => {
    const graph = resolveGraph({
      entities: [entity('a1', 'association', 'HOA'), entity('b1', 'business', 'Lapsed Vendor')],
      relations: [
        relation('r1', 'rt-vendor-for', 'b1', 'a1', {
          attributes: { insuranceExpiresOn: '2026-07-01' },
        }),
      ],
      relationTypes: TYPES,
    })

    const item = computeNeedsAttention(graph, TODAY).find((i) => i.source === 'Vendor insurance')
    expect(item?.urgency).toBe('overdue')
    expect(item?.description).toContain('expired')
  })

  it('does not flag ownerless properties but still flags a missing PIN', () => {
    const graph = resolveGraph({
      entities: [
        entity('lot1', 'property', 'Owned Lot', { pin: '20032 63001' }),
        entity('lot2', 'property', 'Orphan Lot', { pin: '20032 63002' }),
        entity('lot3', 'property', 'No PIN Lot', { pin: null }),
        entity('p1', 'person', 'Owner', { email: 'a@b.test' }),
      ],
      relations: [relation('r1', 'rt-owns', 'p1', 'lot1')],
      relationTypes: TYPES,
    })

    const items = computeNeedsAttention(graph, TODAY)
    const noOwner = items.filter((item) => item.source === 'Missing owner').map((i) => i.entityId)
    const noPin = items.filter((item) => item.source === 'Missing PIN').map((i) => i.entityId)

    expect(noOwner).toEqual([])
    expect(noPin).toEqual(['lot3'])
  })

  it('does not turn an ended ownership into a needs-attention item', () => {
    const graph = resolveGraph({
      entities: [
        entity('lot1', 'property', 'Sold Lot', { pin: '20032 63001' }),
        entity('p1', 'person', 'Prior Owner', { email: 'a@b.test' }),
      ],
      relations: [relation('r1', 'rt-owns', 'p1', 'lot1', { endDate: '2026-03-01' })],
      relationTypes: TYPES,
    })

    expect(computeNeedsAttention(graph, TODAY).some((i) => i.source === 'Missing owner')).toBe(false)
  })

  it('flags a person only when both email and phone are missing', () => {
    const graph = resolveGraph({
      entities: [
        entity('p1', 'person', 'No contact', { email: null, phone: null }),
        entity('p2', 'person', 'Email only', { email: 'a@b.test', phone: null }),
        entity('p3', 'person', 'Phone only', { email: '', phone: '912-555-0100' }),
      ],
      relations: [],
      relationTypes: TYPES,
    })

    const flagged = computeNeedsAttention(graph, TODAY)
      .filter((item) => item.source === 'Missing contact')
      .map((item) => item.entityId)

    expect(flagged).toEqual(['p1'])
  })

  it('sorts overdue first, then soonest, then the data gaps', () => {
    const items = computeNeedsAttention(graphFromDemo(), TODAY)
    const ranks = items.map((item) =>
      item.urgency === 'overdue' ? 0 : item.urgency === 'approaching' ? 1 : 2
    )
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(items.some((item) => item.urgency === 'overdue')).toBe(true)
  })
})

describe('needsAttentionFor', () => {
  it('gives every record exactly the lines the dashboard links to it, in the same order', () => {
    const graph = graphFromDemo()
    const everything = computeNeedsAttention(graph, TODAY)
    expect(everything.length).toBeGreaterThan(0)

    for (const record of graph.entities) {
      expect(needsAttentionFor(graph, record.id, TODAY)).toEqual(
        everything.filter((item) => item.entityId === record.id)
      )
    }
  })

  it('puts a board term on the person, not on the association it is a seat of', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA'),
        entity('p1', 'person', 'Outgoing Secretary', { email: 'a@b.test' }),
      ],
      relations: [
        relation('r1', 'rt-member-of', 'p1', 'a1', {
          endDate: '2026-09-10',
          attributes: { role: 'board', position: 'secretary' },
        }),
      ],
      relationTypes: TYPES,
    })

    const onPerson = needsAttentionFor(graph, 'p1', TODAY)
    expect(onPerson.map((item) => [item.kind, item.description])).toEqual([
      ['term', 'Outgoing Secretary, Secretary of HOA, term ends'],
    ])
    expect(needsAttentionFor(graph, 'a1', TODAY)).toEqual([])
  })

  it('says nothing about an archived record, as the dashboard does not', () => {
    const graph = resolveGraph({
      entities: [{ ...entity('p1', 'person', 'Gone'), archivedAt: '2026-05-01T00:00:00.000Z' }],
      relations: [],
      relationTypes: TYPES,
    })

    expect(needsAttentionFor(graph, 'p1', TODAY)).toEqual([])
    expect(needsAttentionFor(graph, 'no-such-record', TODAY)).toEqual([])
  })
})

describe('computeBoard', () => {
  it('orders president, vice president, treasurer, secretary, then members', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA', { boardSeats: 7 }),
        entity('p1', 'person', 'A Member'),
        entity('p2', 'person', 'B President'),
        entity('p3', 'person', 'C Secretary'),
        entity('p4', 'person', 'D Treasurer'),
        entity('p5', 'person', 'E Vice'),
      ],
      relations: [
        relation('r1', 'rt-member-of', 'p1', 'a1', {
          attributes: { role: 'board', position: 'member' },
        }),
        relation('r2', 'rt-member-of', 'p2', 'a1', {
          attributes: { role: 'board', position: 'president' },
        }),
        relation('r3', 'rt-member-of', 'p3', 'a1', {
          attributes: { role: 'board', position: 'secretary' },
        }),
        relation('r4', 'rt-member-of', 'p4', 'a1', {
          attributes: { role: 'board', position: 'treasurer' },
        }),
        relation('r5', 'rt-member-of', 'p5', 'a1', {
          attributes: { role: 'board', position: 'vice president' },
        }),
      ],
      relationTypes: TYPES,
    })

    const positions = computeBoard(graph, TODAY)[0]?.seats.map((seat) => seat.position)
    expect(positions).toEqual(['president', 'vice president', 'treasurer', 'secretary', 'member'])
  })

  it('leaves out a seat whose term has ended', () => {
    const graph = resolveGraph({
      entities: [
        entity('a1', 'association', 'HOA', { boardSeats: 3 }),
        entity('p1', 'person', 'Past'),
      ],
      relations: [
        relation('r1', 'rt-member-of', 'p1', 'a1', {
          endDate: '2026-01-01',
          attributes: { role: 'board', position: 'president' },
        }),
      ],
      relationTypes: TYPES,
    })

    expect(computeBoard(graph, TODAY)).toHaveLength(0)
  })

  it('does not present the archived placeholder roster as the current board', () => {
    expect(computeBoard(graphFromDemo(), TODAY)).toEqual([])
  })
})

describe('computeOccupancy', () => {
  it('ranks owner-occupied above a short-term listing on the same lot', () => {
    const graph = resolveGraph({
      entities: [
        entity('lot1', 'property', 'Owner lives here and lets a room'),
        entity('p1', 'person', 'Owner'),
        entity('p2', 'person', 'Short stay guest'),
      ],
      relations: [
        relation('r1', 'rt-owns', 'p1', 'lot1'),
        // Deliberately listed before the owner's residency, so a first-match
        // rule would get this wrong.
        relation('r2', 'rt-resides-at', 'p2', 'lot1', {
          attributes: { occupancy: 'short_term_rental' },
        }),
        relation('r3', 'rt-resides-at', 'p1', 'lot1'),
      ],
      relationTypes: TYPES,
    })

    expect(computeOccupancy(graph, TODAY).counts.owner_occupied).toBe(1)
  })

  it('classifies each lot into exactly one segment', () => {
    const graph = resolveGraph({
      entities: [
        entity('lot1', 'property', 'Owner occupied'),
        entity('lot2', 'property', 'Long term rental'),
        entity('lot3', 'property', 'Short term rental'),
        entity('lot4', 'property', 'Empty'),
        entity('p1', 'person', 'Owner'),
        entity('p2', 'person', 'Tenant'),
        entity('p3', 'person', 'Guest'),
        entity('p4', 'person', 'Landlord'),
      ],
      relations: [
        relation('r1', 'rt-owns', 'p1', 'lot1'),
        relation('r2', 'rt-resides-at', 'p1', 'lot1'),
        relation('r3', 'rt-owns', 'p4', 'lot2'),
        relation('r4', 'rt-resides-at', 'p2', 'lot2'),
        relation('r5', 'rt-resides-at', 'p3', 'lot3', {
          attributes: { occupancy: 'short_term_rental' },
        }),
      ],
      relationTypes: TYPES,
    })

    const { total, counts } = computeOccupancy(graph, TODAY)
    expect(total).toBe(4)
    expect(counts).toEqual({
      owner_occupied: 1,
      long_term_rental: 1,
      short_term_rental: 1,
      vacant_or_unknown: 1,
    })
  })

  it('accounts for every lot in the seeded data', () => {
    const { total, counts } = computeOccupancy(graphFromDemo(), TODAY)
    const summed = Object.values(counts).reduce((sum, value) => sum + value, 0)
    expect(summed).toBe(total)
    expect(total).toBe(48)
  })
})
