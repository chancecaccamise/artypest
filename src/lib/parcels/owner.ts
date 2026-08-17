/*
  Turning a county owner-name string into something this app can match against
  and file correctly.

  Two jobs, both pure:

    1. Normalise `SMITH, JOHN A` so it lines up with an existing `John A. Smith`
       instead of creating a duplicate person.
    2. Guess whether the owner is a person or a business, and let the user
       override the guess per row.
*/

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
])

export type OwnerKind = 'person' | 'business'

/**
 * Strips punctuation and case so two spellings of the same name compare equal.
 * `SMITH, JOHN A` and `John A. Smith` both reduce to `a john smith`, because
 * the tokens are sorted: county order and human order differ and neither is
 * canonical.
 */
export function normalizeOwnerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_SUFFIXES.has(token))
    .sort()
    .join(' ')
    .toLowerCase()
}

/**
 * Rewrites a county owner name into the form a person would type.
 * `SMITH, JOHN A` becomes `John A. Smith`. Business names are left alone,
 * because `ABERCORN HOLDINGS LLC` is how the entity is actually filed.
 */
export function toDisplayName(name: string, kind: OwnerKind = classifyOwner(name)): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (kind === 'business') return trimmed

  const [surnamePart, givenPart] = trimmed.split(',', 2)
  const ordered =
    givenPart === undefined ? trimmed : `${givenPart.trim()} ${(surnamePart ?? '').trim()}`

  return ordered
    .split(' ')
    .filter((token) => token !== '')
    .map((token) => {
      const upper = token.toUpperCase().replace(/\./g, '')
      // Roman-numeral and abbreviated suffixes keep their capitals.
      if (NAME_SUFFIXES.has(upper)) return upper === 'JR' || upper === 'SR' ? titleCase(token) : upper
      // A bare initial gets its period back.
      if (upper.length === 1) return `${upper}.`
      return titleCase(token)
    })
    .join(' ')
}

function titleCase(token: string): string {
  const lower = token.toLowerCase()
  // Handles O'Neill and Smith-Jones, where the letter after the mark also caps.
  return lower.replace(/(^|[’'-])([a-z])/g, (_match, prefix: string, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`
  })
}

/**
 * Person or business, from the name alone. A comma is a strong signal for a
 * person because that is how county records write one, but an explicit
 * business token wins over it: `MERCER, JOHN A TRUST` is a trust.
 */
export function classifyOwner(name: string): OwnerKind {
  const tokens = name
    .toUpperCase()
    .replace(/[^A-Z0-9. ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '')

  for (const token of tokens) {
    if (BUSINESS_TOKENS.has(token.replace(/\.$/, ''))) return 'business'
  }

  if (name.includes(',')) return 'person'

  // Three or more words with no personal comma reads as an organisation.
  return tokens.length >= 3 ? 'business' : 'person'
}

export interface OwnerMatch<T> {
  candidate: T
  /** `exact` on the raw string, `normalized` after reordering and stripping. */
  confidence: 'exact' | 'normalized'
}

/**
 * Finds an existing record for an owner name. Tries the raw string first, then
 * the normalised form, which is the check that catches `SMITH, JOHN A` against
 * a stored `John A. Smith`.
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

  return null
}
