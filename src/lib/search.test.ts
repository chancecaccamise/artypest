import { describe, expect, it } from 'vitest'

import type { Entity, EntityType } from '@/lib/data/types'

import { buildSearchIndex, groupHits, normalizeSearchText, searchEntities } from './search'

function entity(
  id: string,
  type: EntityType,
  name: string,
  data: Record<string, unknown> = {},
  overrides: Partial<Entity> = {}
): Entity {
  return {
    id,
    orgId: 'org',
    type,
    name,
    data,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

const ENTITIES: Entity[] = [
  entity('p1', 'property', '10 WHITAKER ST', {
    pin: '20003 15001',
    situsAddress: '10 WHITAKER ST',
    countyOwnerName: 'Jere S Myers',
    neighborhood: 'North Historic District',
  }),
  entity('p2', 'property', '1005 WHITAKER ST UNIT B', {
    pin: '20003 15002',
    situsAddress: '1005 WHITAKER ST UNIT B',
  }),
  entity('p3', 'property', '1402 E 49TH ST', {
    pin: '20084 07008',
    situsAddress: '1402 E 49TH ST',
    countyOwnerName: 'Meredith Cantwell',
  }),
  entity('h1', 'person', 'Meredith Cantwell', { mailingAddress: '1402 E 49th St, Savannah, GA' }),
  entity('b1', 'business', 'Whitaker Property Group LLC', {
    mailingAddress: '12 Bull St, Savannah, GA',
  }),
  entity('a1', 'association', 'Ardsley Park Homeowners Association', {}),
  entity('gone', 'property', '99 GHOST LN', {}, { deletedAt: '2026-02-01T00:00:00.000Z' }),
  entity('old', 'property', '10 WHITAKER ST REAR', {}, { archivedAt: '2026-02-01T00:00:00.000Z' }),
]

const INDEX = buildSearchIndex(ENTITIES)
const BY_ID = new Map(ENTITIES.map((row) => [row.id, row]))

function search(query: string, limit = 20) {
  return searchEntities(INDEX, BY_ID, query, { limit })
}

function names(query: string): string[] {
  return search(query).map((hit) => hit.entity.name)
}

describe('normalizeSearchText', () => {
  it('drops the punctuation people leave out when typing from memory', () => {
    expect(normalizeSearchText('1402 E. 49th St.')).toBe('1402 e 49th st')
    expect(normalizeSearchText("O'Neill")).toBe('o neill')
    expect(normalizeSearchText('20003-15001')).toBe('20003 15001')
  })
})

describe('searchEntities', () => {
  it('finds an address from a partial the way a person types it', () => {
    // The query from the bug report.
    expect(names('10 whitaker')[0]).toBe('10 WHITAKER ST')
  })

  it('prefers the more specific address', () => {
    // 1005 also contains "10" and "whitaker", and is the worse answer.
    const results = names('10 whitaker')
    expect(results.indexOf('10 WHITAKER ST')).toBeLessThan(
      results.indexOf('1005 WHITAKER ST UNIT B')
    )
  })

  it('matches tokens in any order', () => {
    expect(names('whitaker 10')).toContain('10 WHITAKER ST')
    expect(names('49th 1402')).toContain('1402 E 49TH ST')
  })

  it('searches people by name', () => {
    expect(names('cantwell')).toContain('Meredith Cantwell')
  })

  it('finds a lot by its county owner, who has no record of their own', () => {
    /*
      Owner names sit on the parcel rather than becoming entities, so this is
      the only way to get from an owner to their land.
    */
    expect(names('myers')).toContain('10 WHITAKER ST')
  })

  it('finds a lot by PIN, with or without the space', () => {
    expect(names('20084 07008')).toContain('1402 E 49TH ST')
    expect(names('20084-07008')).toContain('1402 E 49TH ST')
  })

  it('searches every kind of record, not just lots', () => {
    expect(names('whitaker')).toContain('Whitaker Property Group LLC')
    expect(names('ardsley')).toContain('Ardsley Park Homeowners Association')
  })

  it('finds a lot by neighborhood', () => {
    expect(names('north historic')).toContain('10 WHITAKER ST')
  })

  it('never returns a deleted record', () => {
    expect(names('ghost')).toEqual([])
  })

  it('returns an archived record, but below the live one', () => {
    const results = names('whitaker st')
    expect(results).toContain('10 WHITAKER ST REAR')
    expect(results.indexOf('10 WHITAKER ST')).toBeLessThan(results.indexOf('10 WHITAKER ST REAR'))
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
  })

  it('honours the limit', () => {
    expect(search('whitaker', 2)).toHaveLength(2)
  })

  it('says what matched, so a result can explain itself', () => {
    expect(search('10 whitaker')[0]?.matchedOn).toBe('name')
    expect(search('myers')[0]?.matchedOn).toBe('detail')
  })

  it('does not match on notes, which are internal', () => {
    const withNote = buildSearchIndex([
      entity('n1', 'property', '5 BULL ST', { notes: 'confidential complaint about raccoons' }),
    ])
    const map = new Map([['n1', ENTITIES[0] as Entity]])
    expect(searchEntities(withNote, map, 'raccoons')).toEqual([])
  })
})

describe('groupHits', () => {
  it('groups by type, and the strongest match decides which group leads', () => {
    // "10 whitaker" is an address, so lots lead.
    const byAddress = groupHits(search('10 whitaker'))
    expect(byAddress[0]?.type).toBe('property')
    expect(byAddress[0]?.label).toBe('Properties')

    /*
      "whitaker" on its own is a better name match for the business actually
      called Whitaker than for a lot on Whitaker Street, so that group leads
      instead. Both are still returned.
    */
    const byName = groupHits(search('whitaker'))
    expect(byName[0]?.type).toBe('business')
    expect(byName.map((group) => group.type)).toContain('property')
  })
})
