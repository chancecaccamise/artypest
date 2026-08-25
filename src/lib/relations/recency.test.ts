import { describe, expect, it } from 'vitest'

import {
  buildRecencyScale,
  compareByDate,
  NEWEST_STRENGTH,
  OLDEST_STRENGTH,
  UNDATED_STRENGTH,
  relationDate,
} from './recency'

const dated = (id: string, startDate: string | null) => ({ id, startDate })

describe('the recency ramp', () => {
  it('puts the oldest at the floor and the newest at full strength', () => {
    const scale = buildRecencyScale([
      dated('a', '2000-01-01'),
      dated('b', '2010-01-01'),
      dated('c', '2020-01-01'),
    ])

    expect(scale.strengthOf('a')).toBeCloseTo(OLDEST_STRENGTH)
    expect(scale.strengthOf('c')).toBeCloseTo(NEWEST_STRENGTH)
    expect(scale.strengthOf('b')).toBeGreaterThan(scale.strengthOf('a'))
    expect(scale.strengthOf('b')).toBeLessThan(scale.strengthOf('c'))
  })

  it('grades on elapsed time, not on rank', () => {
    /*
      The whole argument for this module. Three lots joined together in 2000 and
      one joined in 2020: the three have to stay clustered at the dim end rather
      than being spread evenly across the ramp, because that is what happened.
    */
    const scale = buildRecencyScale([
      dated('a', '2000-01-01'),
      dated('b', '2000-06-01'),
      dated('c', '2001-01-01'),
      dated('d', '2020-01-01'),
    ])

    const clustered = [scale.strengthOf('a'), scale.strengthOf('b'), scale.strengthOf('c')]
    for (const strength of clustered) {
      expect(strength).toBeLessThan(0.4)
    }
    expect(scale.strengthOf('d')).toBeCloseTo(NEWEST_STRENGTH)

    // Rank order would have put the third of four at roughly two thirds.
    expect(scale.positionOf('c')).toBeLessThan(0.1)
  })

  it('refuses to grade a range too short to mean anything', () => {
    const scale = buildRecencyScale([dated('a', '2024-01-01'), dated('b', '2024-01-03')])

    expect(scale.hasSpread).toBe(false)
    expect(scale.spanDays).toBe(0)
    expect(scale.strengthOf('a')).toBe(NEWEST_STRENGTH)
    expect(scale.strengthOf('b')).toBe(NEWEST_STRENGTH)
  })

  it('draws an undated connection in the middle rather than at either end', () => {
    const scale = buildRecencyScale([
      dated('a', '2000-01-01'),
      dated('b', '2020-01-01'),
      dated('c', null),
    ])

    expect(scale.strengthOf('c')).toBe(UNDATED_STRENGTH)
    expect(scale.positionOf('c')).toBeNull()
    expect(scale.undated).toBe(1)
    expect(scale.dated).toBe(2)
  })

  it('reports the real endpoints, for the legend to name', () => {
    const scale = buildRecencyScale([
      dated('a', '1998-04-02'),
      dated('b', '2011-09-30'),
      dated('c', '2024-02-14'),
    ])

    expect(scale.oldest).toBe('1998-04-02')
    expect(scale.newest).toBe('2024-02-14')
    expect(scale.spanDays).toBeGreaterThan(9000)
  })

  it('survives a set with nothing dated in it', () => {
    const scale = buildRecencyScale([dated('a', null), dated('b', null)])

    expect(scale.dated).toBe(0)
    expect(scale.oldest).toBeNull()
    expect(scale.hasSpread).toBe(false)
    expect(scale.strengthOf('a')).toBe(UNDATED_STRENGTH)
    expect(scale.strengthOf('nobody')).toBe(UNDATED_STRENGTH)
  })

  it('ignores an unparseable date rather than throwing', () => {
    const scale = buildRecencyScale([dated('a', 'not a date'), dated('b', '2020-01-01')])

    expect(scale.undated).toBe(1)
    expect(scale.dated).toBe(1)
  })

  it('never reads createdAt as the start of a relationship', () => {
    /*
      A lot that joined in 1998 and was typed into the system last Tuesday is an
      old relationship, not a new one. Reading createdAt would say the opposite,
      which is why relationDate only ever looks at startDate.
    */
    expect(relationDate({ startDate: null })).toBeNull()
    expect(relationDate({ startDate: '1998-01-01' })).toBe('1998-01-01')
  })
})

describe('chronological ordering', () => {
  it('sorts oldest first and undated last', () => {
    const rows = [
      dated('undated', null),
      dated('new', '2022-01-01'),
      dated('old', '1999-01-01'),
      dated('middle', '2010-01-01'),
    ]

    expect([...rows].sort(compareByDate).map((row) => row.id)).toEqual([
      'old',
      'middle',
      'new',
      'undated',
    ])
  })

  it('treats two undated rows as equal, leaving the caller to break the tie', () => {
    expect(compareByDate({ startDate: null }, { startDate: null })).toBe(0)
  })
})
