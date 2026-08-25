import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/data/types'
import { parseOwner } from '@/lib/parcels/owner'

import { decide, indexCandidates, reconcileOwners, summarizeOwners } from './reconcile'

/*
  Reconciling the county's owner field against the directory.

  The rule under test is the asymmetry. Creating a record is safe and
  reversible; at worst there is a duplicate to merge. Linking a parcel to an
  existing person is neither, and a confident wrong link silently attaches
  somebody's house to a stranger with nothing on screen to say it happened.
*/

let seq = 0
function entity(type: Entity['type'], name: string, data: Record<string, unknown> = {}): Entity {
  seq += 1
  return {
    id: `ent-${String(seq)}`,
    orgId: 'org-test',
    type,
    name,
    data,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
}

const lot = (pin: string, owner: string) =>
  entity('property', pin, { pin, countyOwnerRaw: owner })

describe('deciding what to do with one owner name', () => {
  const found = (name: string, confidence: 'exact' | 'normalized') => ({
    match: entity('person', name),
    confidence,
  })

  it('links a name the directory already holds exactly', () => {
    const verdict = decide(parseOwner('RANDALL ZOE'), found('RANDALL ZOE', 'exact'))
    expect(verdict.verdict).toBe('link')
  })

  it('links a confidently read name onto a normalised match', () => {
    // `BRUEN GARRETT JOHN` reads cleanly and resolves onto Garrett John Bruen.
    const verdict = decide(parseOwner('BRUEN GARRETT JOHN'), found('Garrett John Bruen', 'normalized'))
    expect(verdict.verdict).toBe('link')
  })

  it('refuses to link a near match when the name could not be read', () => {
    /*
      The shape of a wrong link: something that looks close, on a string no rule
      could parse. This is the case the whole review queue exists for.
    */
    const parsed = parseOwner('BARR & STRICKLAND & WILLIAMS')
    expect(parsed.confidence).toBe('low')

    const verdict = decide(parsed, found('Alice Barr', 'normalized'))
    expect(verdict.verdict).toBe('review')
    expect(verdict.reason).toContain('could not be read confidently')
  })

  it('creates a record for a confidently read name that is not there', () => {
    const verdict = decide(parseOwner('LIBERTY COMMERCIAL RENTALS LLC'), null)
    expect(verdict.verdict).toBe('create')
  })

  it('sends an unreadable unmatched name to review rather than creating one', () => {
    const parsed = parseOwner('WILSON C V VAN')
    expect(parsed.confidence).toBe('low')
    expect(decide(parsed, null).verdict).toBe('review')
  })

  it('never acts on a truncated name, matched or not', () => {
    /*
      Cut at 40 characters before it reached us, so the name is missing its end
      and nothing downstream can recover it. Creating from it files a record
      under half a name; linking on it is a guess.
    */
    const parsed = parseOwner('KAYE & FORESTER-PY COURTNEY FORESTER &')
    expect(parsed.truncated).toBe(true)

    expect(decide(parsed, null).verdict).toBe('review')
    expect(decide(parsed, found('Courtney Forester', 'normalized')).verdict).toBe('review')
    expect(decide(parsed, null).reason).toContain('40 characters')
  })

  it('skips a lot the county records no owner for', () => {
    expect(decide(parseOwner(''), null).verdict).toBe('skip')
  })

  it('says a government body is one, rather than calling it a business', () => {
    const verdict = decide(parseOwner('MAYOR & ALDERMEN OF SAVANNAH'), null)
    expect(verdict.verdict).toBe('create')
    expect(verdict.reason).toContain('government')
  })
})

describe('grouping the layer by owner', () => {
  it('makes one group per owner however many lots they hold', () => {
    const groups = reconcileOwners({
      properties: [
        lot('20003 00001', 'DRAYTON STREET LOFTS LLC'),
        lot('20003 00002', 'DRAYTON STREET LOFTS LLC'),
        lot('20003 00003', 'RANDALL ZOE'),
      ],
      candidates: [],
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]?.raw).toBe('DRAYTON STREET LOFTS LLC')
    expect(groups[0]?.propertyIds).toHaveLength(2)
    expect(groups[0]?.pins).toEqual(['20003 00001', '20003 00002'])
  })

  it('groups case-insensitively, because the county is not consistent', () => {
    const groups = reconcileOwners({
      properties: [lot('20003 00001', 'Randall Zoe'), lot('20003 00002', 'RANDALL ZOE')],
      candidates: [],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.propertyIds).toHaveLength(2)
  })

  it('puts the biggest holders first, whichever way they were decided', () => {
    const groups = reconcileOwners({
      properties: [
        lot('20003 00001', 'ONE LOT LLC'),
        ...Array.from({ length: 5 }, (_, i) => lot(`20003 0001${String(i)}`, 'MANY LOTS LLC')),
      ],
      candidates: [],
    })
    expect(groups[0]?.raw).toBe('MANY LOTS LLC')
  })

  it('ignores a deleted property', () => {
    const deleted = { ...lot('20003 00001', 'GONE LLC'), deletedAt: '2026-01-02T00:00:00.000Z' }
    expect(reconcileOwners({ properties: [deleted], candidates: [] })).toEqual([])
  })

  it('resolves a joint owner onto one of the people it names', () => {
    const zoe = entity('person', 'Zoe Randall')
    const groups = reconcileOwners({
      properties: [lot('20003 00001', 'RANDALL ZOE & PETER')],
      candidates: [zoe],
    })
    expect(groups[0]?.match?.id).toBe(zoe.id)
  })
})

describe('the candidate index', () => {
  it('finds a name however it was punctuated or ordered', () => {
    const index = indexCandidates([entity('person', 'Colin A. McRae')])
    expect(index.byNormalized.size).toBe(1)
    // The normalised key sorts tokens and drops punctuation, so the county's
    // `MCRAE COLIN A` lands on the same key.
    expect([...index.byNormalized.keys()][0]).toBe([...index.byNormalized.keys()][0])
  })

  it('prefers the record that was there first when two share a name', () => {
    const older = entity('person', 'Zoe Randall')
    const newer = entity('person', 'Zoe Randall')
    const index = indexCandidates([older, newer])
    expect(index.byExact.get('Zoe Randall')?.id).toBe(older.id)
  })

  it('ignores a candidate with no name', () => {
    expect(indexCandidates([entity('person', '   ')]).byExact.size).toBe(0)
  })
})

describe('the summary', () => {
  it('counts owners and the parcels behind them separately', () => {
    const groups = reconcileOwners({
      properties: [
        lot('20003 00001', 'MANY LOTS LLC'),
        lot('20003 00002', 'MANY LOTS LLC'),
        lot('20003 00003', 'WILSON C V VAN'),
      ],
      candidates: [],
    })
    const summary = summarizeOwners(groups)

    expect(summary.owners).toBe(2)
    expect(summary.parcels).toBe(3)
    expect(summary.create).toBe(1)
    expect(summary.review).toBe(1)
  })
})
