import { describe, expect, it } from 'vitest'

import { resolveGraph } from '@/lib/insights'
import type { Entity, Relation, RelationType } from '@/lib/data/types'
import { relationColor } from '@/lib/relations/colors'
import { buildRecencyScale } from '@/lib/relations/recency'

import { buildDemoData } from '@/lib/data/fixtures'

import { buildFanScales, buildRings } from './ConnectionMap'

/*
  The threads on the Connection Map: what colour they are, and what order the
  cards they land on sit in.

  The association case from the brief is the one under test. Eight lots joined
  an association across twenty-odd years, and a reader should be able to see
  which arrived first without opening any of them.
*/

const ORG = 'org-test'

function entity(id: string, type: Entity['type'], name: string): Entity {
  return {
    id,
    orgId: ORG,
    type,
    name,
    data: {},
    folderId: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

function relation(id: string, from: string, to: string, startDate: string | null): Relation {
  return {
    id,
    orgId: ORG,
    relationTypeId: 'rt-member-of',
    fromEntityId: from,
    toEntityId: to,
    startDate,
    endDate: null,
    attributes: {},
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
}

const TYPES: RelationType[] = [
  {
    id: 'rt-member-of',
    orgId: ORG,
    key: 'member_of',
    label: 'is a member of',
    reverseLabel: 'has member',
  },
]

/** Four lots, joined in a deliberately shuffled order. */
const LOTS = [
  { id: 'lot-d', name: '1408 E 49th St', joined: '2021-06-01' },
  { id: 'lot-a', name: '1402 E 49th St', joined: '1999-03-01' },
  { id: 'lot-c', name: '1406 E 49th St', joined: '2014-08-01' },
  { id: 'lot-b', name: '1404 E 49th St', joined: '2003-11-01' },
]

function buildGraph() {
  const hoa = entity('hoa', 'association', 'Ardsley Park Homeowners Association')
  const lots = LOTS.map((lot) => entity(lot.id, 'property', lot.name))
  const relations = LOTS.map((lot, index) =>
    relation(`rel-${String(index)}`, lot.id, 'hoa', lot.joined)
  )

  return {
    graph: resolveGraph({ entities: [hoa, ...lots], relations, relationTypes: TYPES }),
    hoa,
  }
}

describe('threads on the Connection Map', () => {
  it('orders the lots by when they joined, oldest first', () => {
    const { graph, hoa } = buildGraph()
    const { firstRing } = buildRings(graph, hoa, new Set())

    expect(firstRing.map((node) => node.entity.name)).toEqual([
      '1402 E 49th St',
      '1404 E 49th St',
      '1406 E 49th St',
      '1408 E 49th St',
    ])
  })

  it('carries the connection type, so a thread can be drawn in its own colour', () => {
    const { graph, hoa } = buildGraph()
    const { firstRing } = buildRings(graph, hoa, new Set())

    for (const node of firstRing) {
      expect(node.relationKey).toBe('member_of')
      // The same token the plat draws member_of with, and the same one the
      // association type badge uses.
      expect(relationColor(node.relationKey)).toBe('var(--type-association)')
    }
  })

  it('grades the oldest lot faintest and the newest brightest', () => {
    const { graph, hoa } = buildGraph()
    const { firstRing } = buildRings(graph, hoa, new Set())
    const scale = buildRecencyScale(firstRing.map((node) => node.relation))

    const strengths = firstRing.map((node) => scale.strengthOf(node.relation.id))

    // Ordering and brightness agree: leftmost is oldest is faintest.
    for (let index = 1; index < strengths.length; index += 1) {
      expect(strengths[index]).toBeGreaterThan(strengths[index - 1] ?? 0)
    }
    expect(scale.oldest).toBe('1999-03-01')
    expect(scale.newest).toBe('2021-06-01')
  })

  it('still puts ended connections after current ones, whatever their dates', () => {
    const { graph, hoa } = buildGraph()
    // The newest lot left the association, so it should sort last despite being
    // the most recent to join.
    const ended = graph.relations.map((row) =>
      row.fromEntityId === 'lot-d' ? { ...row, endDate: '2023-01-01' } : row
    )
    const withEnded = resolveGraph({
      entities: graph.entities,
      relations: ended,
      relationTypes: TYPES,
    })

    const { firstRing } = buildRings(withEnded, hoa, new Set())

    expect(firstRing.at(-1)?.entity.name).toBe('1408 E 49th St')
    expect(firstRing.at(-1)?.current).toBe(false)
  })

  it('leaves undated connections at the end of the row', () => {
    const hoa = entity('hoa', 'association', 'Ardsley Park Homeowners Association')
    const lots = [entity('lot-x', 'property', 'Undated Lot'), entity('lot-y', 'property', 'Dated Lot')]
    const graph = resolveGraph({
      entities: [hoa, ...lots],
      relations: [
        relation('rel-x', 'lot-x', 'hoa', null),
        relation('rel-y', 'lot-y', 'hoa', '2015-01-01'),
      ],
      relationTypes: TYPES,
    })

    const { firstRing } = buildRings(graph, hoa, new Set())

    expect(firstRing.map((node) => node.entity.name)).toEqual(['Dated Lot', 'Undated Lot'])
  })
})

describe('each fan is graded against itself', () => {
  it('does not let one bright thread elsewhere flatten a whole group', () => {
    /*
      The bug this exists to prevent. One ramp across the whole drawing spends
      its range on the widest gap anywhere on screen, so a focus record whose
      own address was recorded last week pushes every lot under an association
      onto the dim end, indistinguishable from each other.
    */
    const hoa = entity('hoa', 'association', 'Ardsley Park Homeowners Association')
    const person = entity('person', 'person', 'Daniel Okonkwo')
    const lots = LOTS.map((lot) => entity(lot.id, 'property', lot.name))

    const graph = resolveGraph({
      entities: [person, hoa, ...lots],
      relations: [
        // The focus record's own very recent connection.
        relation('rel-focus', 'person', 'hoa', '2026-08-01'),
        ...LOTS.map((lot, index) => relation(`rel-${String(index)}`, lot.id, 'hoa', lot.joined)),
      ],
      relationTypes: TYPES,
    })

    const { firstRing, secondRing } = buildRings(graph, person, new Set())
    const scales = buildFanScales([...firstRing, ...secondRing])

    const fan = scales.get('hoa')
    expect(fan).toBeDefined()
    // The association's own fan runs 1999 to 2021, not 1999 to 2026.
    expect(fan?.oldest).toBe('1999-03-01')
    expect(fan?.newest).toBe('2021-06-01')

    const lotNodes = secondRing.filter((node) => node.parentId === 'hoa')
    const strengths = lotNodes.map((node) => fan?.strengthOf(node.relation.id) ?? 0)

    // Full contrast is spent inside the group: floor to ceiling, not squashed.
    expect(Math.min(...strengths)).toBeCloseTo(0.3)
    expect(Math.max(...strengths)).toBeCloseTo(1)
  })

  it('gives a fan of one nothing to say, rather than calling it new', () => {
    const { graph, hoa } = buildGraph()
    const scales = buildFanScales(buildRings(graph, hoa, new Set()).firstRing)

    const fan = scales.get('hoa')
    expect(fan?.hasSpread).toBe(true)
    expect(scales.size).toBe(1)
  })
})

describe('the seeded association, end to end', () => {
  it('grades the demo association\'s members across a real span of years', () => {
    /*
      Guards the fixture as much as the code. These memberships carried no
      startDate at all until this feature needed one, so every thread graded
      identically and the map had nothing to say.
    */
    const data = buildDemoData(new Date('2026-08-24T00:00:00.000Z'))
    const graph = resolveGraph(data)
    const association = data.entities.find((row) => row.id === 'ent-assoc-ardsley')
    expect(association).toBeDefined()

    const { firstRing } = buildRings(graph, association as Entity, new Set())
    const members = firstRing.filter((node) => node.relationKey === 'member_of')
    expect(members.length).toBeGreaterThan(8)

    for (const node of members) {
      expect(node.relation.startDate).not.toBeNull()
    }

    const scales = buildFanScales(firstRing)
    const fan = scales.get(association?.id ?? '')
    expect(fan?.hasSpread).toBe(true)
    // Two decades and more between the founding lots and the newest arrivals.
    expect(fan?.spanDays ?? 0).toBeGreaterThan(3000)

    /*
      Chronological within the memberships that still stand. Ended ones sort to
      the end regardless of when they began, which is the existing convention:
      "this used to be true" belongs after everything that is true now, however
      recently it started.
    */
    const live = members.filter((node) => node.current)
    const ended = members.filter((node) => !node.current)
    expect(ended.length).toBeGreaterThan(0)
    expect(members.slice(-ended.length).every((node) => !node.current)).toBe(true)

    const dates = live.map((node) => node.relation.startDate ?? '')
    expect([...dates].sort()).toEqual(dates)
  })
})
