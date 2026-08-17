import { describe, expect, it } from 'vitest'

import {
  classifyOwner,
  findOwnerMatch,
  normalizeOwnerName,
  parseOwner,
  toDisplayName,
} from './owner'

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
    // The suffix moves to the end, where a person would write it.
    expect(toDisplayName('RUTLEDGE, HAROLD III')).toBe('Harold Rutledge III')
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

/*
  Everything below is a real value from the live SAGIS service, not an invented
  one. See docs/SAGIS-API.md. These are the cases the previous implementation
  got wrong, and they are the majority of Chatham County rather than the edges.
*/
describe('real SAGIS owner strings', () => {
  it('no longer calls a three-word person a business', () => {
    // The old rule was "three or more words with no comma reads as an
    // organisation", which covered most of the county.
    expect(classifyOwner('BRUEN GARRETT JOHN')).toBe('person')
    expect(classifyOwner('WILSON C V VAN')).toBe('person')
    expect(classifyOwner('KENNEDY MARY CLAYTON & AUSTIN O')).toBe('person')
  })

  it('does not read the ampersand in an organisation name as a co-owner', () => {
    const parsed = parseOwner('MAYOR & ALDERMEN OF SAVANNAH')
    expect(parsed.kind).toBe('business')
    expect(parsed.government).toBe(true)
    expect(parsed.people).toEqual([])
  })

  it.each([
    ['RANDALL ZOE', 'Zoe Randall'],
    ['BRUEN GARRETT JOHN', 'Garrett John Bruen'],
    ['SASEEN JOSEPH O.', 'Joseph O. Saseen'],
    ['KEENER-MACKENZIE JANE', 'Jane Keener-Mackenzie'],
    ['GRANT SAVANNAH', 'Savannah Grant'],
  ])('reads %j as %j', (raw, expected) => {
    const parsed = parseOwner(raw)
    expect(parsed.kind).toBe('person')
    expect(parsed.display).toBe(expected)
    expect(parsed.confidence).toBe('high')
  })

  it('shares one surname across two given names', () => {
    const parsed = parseOwner('BELZER NATHAN C & ALLISON S')
    expect(parsed.people.map((person) => person.display)).toEqual([
      'Nathan C. Belzer',
      'Allison S. Belzer',
    ])
    expect(parsed.confidence).toBe('high')
  })

  it('interleaves two surnames with two given names, and says it is unsure', () => {
    const parsed = parseOwner('LEVIN & WHITEHURST DARIA & SCOTT*')
    expect(parsed.people.map((person) => person.display)).toEqual([
      'Daria Levin',
      'Scott Whitehurst',
    ])
    // The convention is inferred from the data, not stated by it.
    expect(parsed.confidence).toBe('low')
    expect(parsed.marked).toBe(true)
  })

  it('strips the trailing record marker', () => {
    expect(parseOwner('MCRAE COLIN A & LINDSAY M*').marked).toBe(true)
    expect(parseOwner('MCRAE COLIN A & LINDSAY M*').raw).toContain('*')
    expect(parseOwner('MCRAE COLIN A & LINDSAY M*').people[0]?.display).toBe('Colin A. McRae')
  })

  it('detects a name truncated upstream and refuses to be confident about it', () => {
    const parsed = parseOwner('KAYE & FORESTER-PY COURTNEY FORESTER &')
    expect(parsed.truncated).toBe(true)
    expect(parsed.confidence).toBe('low')
  })

  it('reads Owner and Owner2 together', () => {
    const parsed = parseOwner('ACUFF DAVID STEPHEN', 'ACUFF AMANTE SMITH')
    expect(parsed.people.map((person) => person.display)).toEqual([
      'David Stephen Acuff',
      'Amante Smith Acuff',
    ])
  })

  it('continues a dangling ampersand into Owner2 without repeating the surname', () => {
    const parsed = parseOwner('ANDRESEN ROBERT A. &', 'ANDRESEN BARBARA F.*')
    expect(parsed.people.map((person) => person.display)).toEqual([
      'Robert A. Andresen',
      'Barbara F. Andresen',
    ])
    expect(parsed.truncated).toBe(true)
  })

  it('flags a name with no resolvable surname boundary', () => {
    const parsed = parseOwner('WILSON C V VAN')
    expect(parsed.confidence).toBe('low')
  })

  it('leaves an organisation name as filed', () => {
    const parsed = parseOwner('LIBERTY COMMERCIAL RENTALS LLC')
    expect(parsed.kind).toBe('business')
    expect(parsed.display).toBe('LIBERTY COMMERCIAL RENTALS LLC')
    expect(parsed.government).toBe(false)
  })

  it('finds one owner inside a joint-owner string', () => {
    const people = [{ name: 'Allison S. Belzer' }, { name: 'Unrelated Person' }]
    const match = findOwnerMatch('BELZER NATHAN C & ALLISON S', people)
    expect(match?.candidate.name).toBe('Allison S. Belzer')
  })

  it('normalises the space-separated form onto a stored readable name', () => {
    expect(normalizeOwnerName('RANDALL ZOE')).toBe(normalizeOwnerName('Zoe Randall'))
    expect(normalizeOwnerName('BRUEN GARRETT JOHN')).toBe(normalizeOwnerName('Garrett John Bruen'))
  })
})

/*
  Cases found only after the fixture was rebuilt from real E 49th St records.
  Each one is a live value.
*/
describe('owner strings from the Ardsley Park fixture', () => {
  it('moves a generational suffix out of the middle of the name', () => {
    const parsed = parseOwner('LYNCH LAWRENCE J JR & SHARON COOPER*')
    expect(parsed.people[0]?.display).toBe('Lawrence J. Lynch Jr')
    expect(parsed.confidence).toBe('high')
  })

  it('reads a suffix that sits before the given name', () => {
    // NORCIA, III MATTHEW M. puts the suffix first, after the comma.
    expect(parseOwner('NORCIA, III MATTHEW M.').people[0]?.display).toBe('Matthew M. Norcia III')
  })

  it('does not mistake a middle initial V for a generational suffix', () => {
    expect(parseOwner('WILSON C V VAN').confidence).toBe('low')
    expect(parseOwner('RUTLEDGE HAROLD V').people[0]?.display).toBe('Harold Rutledge V')
  })

  it('treats ET AL as owners the county did not name', () => {
    const parsed = parseOwner('GREEN DAVID DARNELL ET AL*')
    expect(parsed.people[0]?.display).toBe('David Darnell Green')
    // There are other owners, so this reading is incomplete by definition.
    expect(parsed.confidence).toBe('low')
  })

  it('interleaves two surnames with two given names', () => {
    const parsed = parseOwner('CANTWELL & PRZYBYL MEREDITH & NICHOLAS*')
    expect(parsed.people.map((person) => person.display)).toEqual([
      'Meredith Cantwell',
      'Nicholas Przybyl',
    ])
  })

  it('handles a trust whose name is cut off mid-word across both fields', () => {
    // Owner ends "...OF THE DO" and Owner2 begins "WELL FAMILY TRUST".
    const parsed = parseOwner(
      'DIANE DOWELL SATURDAY, TRUSTEE OF THE DO',
      'WELL FAMILY TRUST DATED JULY 1, 2008'
    )
    expect(parsed.kind).toBe('business')
    expect(parsed.truncated).toBe(true)
    expect(parsed.confidence).toBe('low')
  })

  it('reads a plain two-token owner with confidence', () => {
    const parsed = parseOwner('WILLIAMS PATRICK')
    expect(parsed.display).toBe('Patrick Williams')
    expect(parsed.confidence).toBe('high')
  })
})
