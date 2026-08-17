import { describe, expect, it } from 'vitest'

import { classifyOwner, findOwnerMatch, normalizeOwnerName, toDisplayName } from './owner'

describe('normalizeOwnerName', () => {
  it('reduces county order and human order to the same key', () => {
    expect(normalizeOwnerName('SMITH, JOHN A')).toBe(normalizeOwnerName('John A. Smith'))
  })

  it('ignores punctuation and case', () => {
    expect(normalizeOwnerName('OKONKWO, DANIEL')).toBe(normalizeOwnerName('daniel okonkwo'))
  })

  it('ignores generational suffixes, which the county records inconsistently', () => {
    expect(normalizeOwnerName('BRANTLEY, OTIS JR')).toBe(normalizeOwnerName('Otis Brantley'))
  })

  it('keeps genuinely different people apart', () => {
    expect(normalizeOwnerName('SMITH, JOHN A')).not.toBe(normalizeOwnerName('SMITH, JANE A'))
    expect(normalizeOwnerName('John Smith')).not.toBe(normalizeOwnerName('John Smithson'))
  })
})

describe('classifyOwner', () => {
  it.each([
    'ABERCORN HOLDINGS LLC',
    'LOW COUNTRY RENTALS INC',
    'MERCER FAMILY TRUST',
    'VICTORY DRIVE PARTNERS LP',
    'BULL STREET INVESTMENTS CORP',
    'ARDSLEY PARK CIVIC ASSOCIATION',
  ])('reads %j as a business', (name) => {
    expect(classifyOwner(name)).toBe('business')
  })

  it.each(['SMITH, JOHN A', 'Teresa Vaughn', 'OKONKWO, DANIEL', 'BRANTLEY, OTIS JR'])(
    'reads %j as a person',
    (name) => {
      expect(classifyOwner(name)).toBe('person')
    }
  )

  it('lets an explicit business token beat the personal comma', () => {
    expect(classifyOwner('MERCER, JOHN A TRUST')).toBe('business')
  })

  it('matches business tokens as whole words only', () => {
    expect(classifyOwner('TRUSTMAN, ELIAS')).toBe('person')
    expect(classifyOwner('Delia Incola')).toBe('person')
  })
})

describe('toDisplayName', () => {
  it('reorders a county person name and restores the initial period', () => {
    expect(toDisplayName('SMITH, JOHN A')).toBe('John A. Smith')
  })

  it('handles a person with no middle initial', () => {
    expect(toDisplayName('OKONKWO, DANIEL')).toBe('Daniel Okonkwo')
  })

  it('leaves a business name as filed', () => {
    expect(toDisplayName('ABERCORN HOLDINGS LLC')).toBe('ABERCORN HOLDINGS LLC')
  })

  it('capitalises after an apostrophe or hyphen', () => {
    expect(toDisplayName("O'NEILL, MARCUS")).toBe("Marcus O'Neill")
    expect(toDisplayName('SMITH-JONES, PRIYA')).toBe('Priya Smith-Jones')
  })

  it('keeps a roman numeral suffix in capitals', () => {
    expect(toDisplayName('RUTLEDGE, HAROLD III')).toBe('Harold III Rutledge')
  })
})

describe('findOwnerMatch', () => {
  const people = [
    { id: 'p1', name: 'John A. Smith' },
    { id: 'p2', name: 'Teresa Vaughn' },
    { id: 'p3', name: 'ABERCORN HOLDINGS LLC' },
  ]

  it('matches exactly when the strings agree', () => {
    const match = findOwnerMatch('ABERCORN HOLDINGS LLC', people)
    expect(match?.candidate.id).toBe('p3')
    expect(match?.confidence).toBe('exact')
  })

  it('matches a county name against a stored human name', () => {
    const match = findOwnerMatch('SMITH, JOHN A', people)
    expect(match?.candidate.id).toBe('p1')
    expect(match?.confidence).toBe('normalized')
  })

  it('returns null when nothing matches, so the row becomes a create', () => {
    expect(findOwnerMatch('CAVANAUGH, NAOMI', people)).toBeNull()
  })

  it('returns null for an empty name rather than matching everything', () => {
    expect(findOwnerMatch('   ', people)).toBeNull()
  })
})
