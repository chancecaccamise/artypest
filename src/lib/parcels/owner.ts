/*
  Turning a county owner-name string into something this app can match against
  and file correctly.

  The grammar here is the real one, taken from the live service and recorded in
  docs/SAGIS-API.md. It is not the `SURNAME, FIRST` shape this file used to
  assume: that form is 9,844 records against 115,312 without a comma, so it
  describes 7.9% of Chatham County.

  What the county actually writes:

    RANDALL ZOE                              SURNAME GIVEN
    BRUEN GARRETT JOHN                       SURNAME GIVEN MIDDLE
    BELZER NATHAN C & ALLISON S              SURNAME GIVEN1 & GIVEN2
    LEVIN & WHITEHURST DARIA & SCOTT         SURNAME1 & SURNAME2 GIVEN1 & GIVEN2
    MCRAE COLIN A & LINDSAY M*               trailing record marker
    ANDRESEN ROBERT A. &                     continues into the Owner2 field
    KAYE & FORESTER-PY COURTNEY FORESTER &   truncated upstream at 40 characters
    LIBERTY COMMERCIAL RENTALS LLC           organisation
    MAYOR & ALDERMEN OF SAVANNAH             government, and the & is not a co-owner
    WILSON C V VAN                           no reliable surname boundary
    GRANT SAVANNAH                           a person, and a place-name trap

  Two consequences shape the design. An ampersand is not a reliable co-owner
  delimiter, because organisation names contain it. And some values cannot be
  parsed by any rule, so this module reports low confidence rather than
  guessing. A confident wrong match silently attaches a property to the wrong
  resident, which is the worst thing this application can do.
*/

/**
 * The Board of Assessors truncates the owner field at 40 characters before it
 * reaches us. The field itself is declared 50 wide, so the loss happens
 * upstream and no amount of care here recovers it.
 */
export const OWNER_TRUNCATION_LENGTH = 40

/** Suffixes that are part of a person's name, not part of a surname. */
const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V'])

/**
 * Tokens that mean the owner is an organisation. Matched against whole words,
 * so `TRUSTMAN` is not a trust and `LPGA` is not a limited partnership.
 */
const BUSINESS_TOKENS = new Set([
  'LLC',
  'L.L.C.',
  'INC',
  'INCORPORATED',
  'CORP',
  'CORPORATION',
  'TRUST',
  'TRUSTEE',
  'TRUSTEES',
  'LP',
  'LLP',
  'LTD',
  'COMPANY',
  'CO',
  'ASSOCIATION',
  'ASSOCIATES',
  'PARTNERS',
  'PARTNERSHIP',
  'HOLDINGS',
  'PROPERTIES',
  'INVESTMENTS',
  'GROUP',
  'FOUNDATION',
  'CHURCH',
  'BANK',
  'REALTY',
  'RENTALS',
  'DEVELOPMENT',
  'ENTERPRISES',
  'VENTURES',
])

/**
 * Government owners. They are filed as businesses, because the entity types do
 * not have a government kind, but they are worth telling apart: a city or a
 * county is never a resident and should never be offered as an owner match for
 * a person.
 */
const GOVERNMENT_TOKENS = new Set([
  'MAYOR',
  'ALDERMEN',
  'CITY',
  'COUNTY',
  'STATE',
  'AUTHORITY',
  'COMMISSION',
  'BOARD',
  'DISTRICT',
  'HOUSING',
  'SCHOOL',
  'MUNICIPAL',
  'GOVERNMENT',
  'USA',
])

export type OwnerKind = 'person' | 'business'

/**
 * `low` means a human should confirm the reading before it creates or links a
 * record. It is about whether the name was parsed correctly, not about how many
 * owners there are.
 */
export type OwnerConfidence = 'high' | 'low'

export interface PersonName {
  surname: string
  /** Given names and initials, in the order the county wrote them. */
  given: string
  /** Written the way a person would type it: `Colin A. McRae`. */
  display: string
}

export interface ParsedOwner {
  /** The county string or strings, joined, unchanged. */
  raw: string
  kind: OwnerKind
  /** A government body. Still filed as a business, but never a resident. */
  government: boolean
  /** One entry per person named. Empty when kind is business. */
  people: PersonName[]
  /** The primary owner for filing. The cleaned county string for a business. */
  display: string
  /** Truncated upstream, so the name is incomplete and cannot be completed. */
  truncated: boolean
  confidence: OwnerConfidence
  /** The trailing marker the county appends to some records was present. */
  marked: boolean
}

/* ------------------------------------------------------------- cleaning -- */

interface Cleaned {
  text: string
  marked: boolean
  truncated: boolean
}

/**
 * Removes the trailing record marker and normalises whitespace, and reports
 * whether the value looks cut off.
 *
 * A value is treated as truncated when it reaches the county's 40-character
 * limit, or when it ends on an ampersand, which means the name continued into
 * a field that was not wide enough to hold it.
 */
export function cleanOwnerString(raw: string): Cleaned {
  const collapsed = raw.trim().replace(/\s+/g, ' ')
  const marked = collapsed.endsWith('*')
  const unmarked = (marked ? collapsed.slice(0, -1) : collapsed).trim()

  const truncated = collapsed.length >= OWNER_TRUNCATION_LENGTH || unmarked.endsWith('&')

  return { text: unmarked.replace(/&\s*$/, '').trim(), marked, truncated }
}

/* --------------------------------------------------------- classifying -- */

function tokenize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9.& ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '')
}

/** True when the name names a government body rather than a private owner. */
export function isGovernmentOwner(name: string): boolean {
  return tokenize(name).some((token) => GOVERNMENT_TOKENS.has(token.replace(/\.$/, '')))
}

/**
 * Person or business, from the name alone.
 *
 * This deliberately has no "three or more words means an organisation" rule.
 * That rule is what the previous version used, and against real data it called
 * `BRUEN GARRETT JOHN` and `WILSON C V VAN` businesses, which is most of the
 * county. Only an explicit organisation or government token decides it now.
 */
export function classifyOwner(name: string): OwnerKind {
  const tokens = tokenize(name)

  for (const token of tokens) {
    const bare = token.replace(/\.$/, '')
    if (BUSINESS_TOKENS.has(bare) || GOVERNMENT_TOKENS.has(bare)) return 'business'
  }

  return 'person'
}

/* -------------------------------------------------------------- parsing -- */

function personFrom(surname: string, given: string): PersonName {
  const cleanSurname = surname.trim()
  const cleanGiven = given.trim()
  const display = [cleanGiven, cleanSurname]
    .filter((part) => part !== '')
    .join(' ')
    .split(' ')
    .map(formatNameToken)
    .join(' ')

  return { surname: cleanSurname, given: cleanGiven, display }
}

/**
 * Reads one county name segment as `SURNAME GIVEN...`, or as
 * `SURNAME, GIVEN...` when a comma is present.
 *
 * Confidence drops when there is no way to tell where the surname ends:
 * `WILSON C V VAN` has four tokens and no comma, and no rule resolves it.
 */
function parseSingleName(segment: string): { person: PersonName; confidence: OwnerConfidence } {
  const commaIndex = segment.indexOf(',')
  if (commaIndex !== -1) {
    const surname = segment.slice(0, commaIndex)
    const given = segment.slice(commaIndex + 1)
    return { person: personFrom(surname, given), confidence: 'high' }
  }

  const tokens = segment.split(' ').filter((token) => token !== '')
  if (tokens.length === 0) {
    return { person: personFrom('', ''), confidence: 'low' }
  }
  if (tokens.length === 1) {
    // A surname with no given name, or a given name with no surname. Unknowable.
    return { person: personFrom(tokens[0] ?? '', ''), confidence: 'low' }
  }

  const [surname, ...given] = tokens
  // Surname plus up to two given tokens reads cleanly. More than that and the
  // boundary is a guess, so say so.
  const confidence: OwnerConfidence = given.length <= 2 ? 'high' : 'low'

  return { person: personFrom(surname ?? '', given.join(' ')), confidence }
}

/**
 * Parses one owner field into the people it names.
 *
 * The ampersand cases, in the order they are tried:
 *
 *   `SURNAME GIVEN1 & GIVEN2`             one surname, shared
 *   `SURNAME1 & SURNAME2 GIVEN1 & GIVEN2` surnames and given names interleave
 *
 * The second form is an inference about the county's conventions rather than
 * something the data states, so it is always low confidence.
 */
function parsePersonField(text: string): { people: PersonName[]; confidence: OwnerConfidence } {
  const segments = text
    .split('&')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')

  if (segments.length <= 1) {
    const single = parseSingleName(segments[0] ?? '')
    return { people: [single.person], confidence: single.confidence }
  }

  if (segments.length === 2) {
    const leftTokens = (segments[0] ?? '').split(' ').filter((token) => token !== '')
    const right = segments[1] ?? ''

    if (leftTokens.length >= 2) {
      const [surname, ...given] = leftTokens
      const rightTokens = right.split(' ').filter((token) => token !== '')

      // `ANDRESEN ROBERT A. & ANDRESEN BARBARA F.` repeats the surname, so the
      // right side is a whole name rather than a bare given name.
      const rightRepeatsSurname = rightTokens.length >= 2 && rightTokens[0] === surname
      const second = rightRepeatsSurname
        ? personFrom(rightTokens[0] ?? '', rightTokens.slice(1).join(' '))
        : personFrom(surname ?? '', right)

      const first = personFrom(surname ?? '', given.join(' '))
      return { people: [first, second], confidence: given.length <= 2 ? 'high' : 'low' }
    }

    // `LEVIN & WHITEHURST DARIA`: a surname, then a whole other name.
    const other = parseSingleName(right)
    return { people: [other.person], confidence: 'low' }
  }

  // Three segments: `SURNAME1 & SURNAME2 GIVEN1 & GIVEN2`.
  const first = segments[0] ?? ''
  const middleTokens = (segments[1] ?? '').split(' ').filter((token) => token !== '')
  const last = segments[2] ?? ''

  if (middleTokens.length >= 2) {
    const surnames = [first, middleTokens[0] ?? '']
    const givens = [middleTokens.slice(1).join(' '), last]
    return {
      people: [
        personFrom(surnames[0] ?? '', givens[0] ?? ''),
        personFrom(surnames[1] ?? '', givens[1] ?? ''),
      ],
      confidence: 'low',
    }
  }

  const fallback = parseSingleName(segments.join(' '))
  return { people: [fallback.person], confidence: 'low' }
}

/**
 * Parses the county's `Owner` and `Owner2` fields together.
 *
 * The two fields are read independently and their people merged, because
 * Owner2 holds a whole name (`ACUFF AMANTE SMITH`) rather than a fragment,
 * including in the case where Owner ended on a dangling ampersand.
 */
export function parseOwner(owner: string, owner2?: string | null): ParsedOwner {
  const primary = cleanOwnerString(owner ?? '')
  const secondary = cleanOwnerString(owner2 ?? '')

  const rawParts = [owner ?? '', owner2 ?? ''].map((part) => part.trim()).filter((part) => part !== '')
  const raw = rawParts.join(' & ')

  const combinedForClassification = [primary.text, secondary.text].filter((part) => part !== '').join(' ')
  const kind = classifyOwner(combinedForClassification)
  const government = isGovernmentOwner(combinedForClassification)
  const truncated = primary.truncated || secondary.truncated
  const marked = primary.marked || secondary.marked

  if (kind === 'business') {
    return {
      raw,
      kind,
      government,
      people: [],
      display: primary.text,
      truncated,
      // An organisation name is filed as written, so truncation is the only
      // thing that makes it uncertain.
      confidence: truncated ? 'low' : 'high',
      marked,
    }
  }

  const parsedPrimary = parsePersonField(primary.text)
  const parsedSecondary =
    secondary.text === '' ? null : parsePersonField(secondary.text)

  const people = [...parsedPrimary.people, ...(parsedSecondary?.people ?? [])].filter(
    (person) => person.display !== ''
  )

  const confidence: OwnerConfidence =
    truncated ||
    parsedPrimary.confidence === 'low' ||
    parsedSecondary?.confidence === 'low' ||
    people.length === 0
      ? 'low'
      : 'high'

  return {
    raw,
    kind,
    government,
    people,
    display: people[0]?.display ?? primary.text,
    truncated,
    confidence,
    marked,
  }
}

/* ---------------------------------------------------------- formatting -- */

function formatNameToken(token: string): string {
  const upper = token.toUpperCase().replace(/\./g, '')
  if (upper === '') return token

  // Roman-numeral and abbreviated suffixes keep their capitals.
  if (NAME_SUFFIXES.has(upper)) return upper === 'JR' || upper === 'SR' ? titleCase(token) : upper
  // A bare initial gets its period back.
  if (upper.length === 1) return `${upper}.`
  return titleCase(token)
}

function titleCase(token: string): string {
  const lower = token.toLowerCase()
  const cased = lower.replace(/(^|[’'-])([a-z])/g, (_match, prefix: string, letter: string) => {
    // Handles O'Neill and Smith-Jones, where the letter after the mark also caps.
    return `${prefix}${letter.toUpperCase()}`
  })

  // The county writes in capitals, so `MCRAE` would otherwise read `Mcrae` on
  // screen. Mac is left alone: Macon and MacDonald are not the same case.
  if (/^MC[A-Z]{2,}$/.test(token)) {
    return `Mc${cased.charAt(2).toUpperCase()}${cased.slice(3)}`
  }

  return cased
}

/**
 * Rewrites a county owner name into the form a person would type.
 * `SMITH, JOHN A` and `SMITH JOHN A` both become `John A. Smith`. Business
 * names are left alone, because `ABERCORN HOLDINGS LLC` is how the entity is
 * actually filed.
 */
export function toDisplayName(name: string, kind: OwnerKind = classifyOwner(name)): string {
  const { text } = cleanOwnerString(name)
  if (kind === 'business') return text

  const parsed = parsePersonField(text)
  const display = parsed.people
    .map((person) => person.display)
    .filter((part) => part !== '')
    .join(' and ')

  return display === '' ? text : display
}

/* ------------------------------------------------------------ matching -- */

/**
 * Strips punctuation, markers, and case so two spellings of the same name
 * compare equal. `SMITH, JOHN A`, `SMITH JOHN A`, and `John A. Smith` all
 * reduce to `a john smith`, because the tokens are sorted: county order and
 * human order differ and neither is canonical.
 */
export function normalizeOwnerName(name: string): string {
  const { text } = cleanOwnerString(name)
  return text
    .toUpperCase()
    .replace(/[.,&]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_SUFFIXES.has(token))
    .sort()
    .join(' ')
    .toLowerCase()
}

export interface OwnerMatch<T> {
  candidate: T
  /** `exact` on the raw string, `normalized` after reordering and stripping. */
  confidence: 'exact' | 'normalized'
}

/**
 * Finds an existing record for an owner name. Tries the raw string, then the
 * normalised form, then each person the county string names, which is the check
 * that finds `Allison S Belzer` inside `BELZER NATHAN C & ALLISON S`.
 */
export function findOwnerMatch<T extends { name: string }>(
  ownerName: string,
  candidates: readonly T[]
): OwnerMatch<T> | null {
  const trimmed = ownerName.trim()

  const exact = candidates.find((candidate) => candidate.name.trim() === trimmed)
  if (exact) return { candidate: exact, confidence: 'exact' }

  const key = normalizeOwnerName(trimmed)
  if (key === '') return null

  const normalized = candidates.find((candidate) => normalizeOwnerName(candidate.name) === key)
  if (normalized) return { candidate: normalized, confidence: 'normalized' }

  // A joint-owner string does not normalise onto either owner on its own, so
  // try the people it names before giving up.
  const parsed = parseOwner(trimmed)
  for (const person of parsed.people) {
    const personKey = normalizeOwnerName(person.display)
    if (personKey === '') continue
    const found = candidates.find((candidate) => normalizeOwnerName(candidate.name) === personKey)
    if (found) return { candidate: found, confidence: 'normalized' }
  }

  return null
}
