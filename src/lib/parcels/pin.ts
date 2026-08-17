/*
  SAGIS PIN handling. Pure functions, no network, no lookup.

  The shapes here were checked against the live service. See docs/SAGIS-API.md.
  CLAUDE.md names two formats and there are at least three.
*/

/**
 * A SAGIS PIN is five digits, a separator, five digits, and sometimes a
 * trailing letter. All three of these are real parcels:
 *
 *   20074 45001    11 characters, space separator
 *   10025C01001    11 characters, a letter in place of the space
 *   10011 02012C   12 characters, a space separator AND a trailing letter
 *
 * The third form used to be rejected. It is a real parcel at 106 San Marco Dr.
 * The county declares the field 15 characters wide, so further variation is
 * possible: prefer widening this pattern over pinning the length.
 */
const PIN_PATTERN = /^\d{5}(?: |[A-Z])\d{5}([A-Z])?$/

/** Which separator the PIN uses. The trailing letter is reported separately. */
export type PinFormat = 'spaced' | 'lettered'

export interface PinValidation {
  valid: boolean
  /** Which separator shape it is, when valid. */
  format: PinFormat | null
  /**
   * The trailing letter, when there is one. Part of the identifier, so it must
   * be kept: `10011 02012C` and `10011 02012` would be different parcels.
   */
  suffix: string | null
  /** Present when invalid. Says what is wrong, not that something is wrong. */
  error: string | null
}

/**
 * Normalises a PIN for comparison and storage: trims, collapses runs of
 * whitespace to one space, and uppercases the separator letter.
 *
 * Matching on the normalised form is what lets a pasted `20032  63001` line up
 * with a stored `20032 63001`.
 */
export function normalizePin(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function validatePin(input: string): PinValidation {
  const pin = normalizePin(input)

  if (pin === '') {
    return {
      valid: false,
      format: null,
      suffix: null,
      error: 'Enter a parcel identification number.',
    }
  }

  const match = PIN_PATTERN.exec(pin)
  if (match) {
    return {
      valid: true,
      format: pin.charAt(5) === ' ' ? 'spaced' : 'lettered',
      suffix: match[1] ?? null,
      error: null,
    }
  }

  // Say which shape it missed, and how.
  if (pin.length !== 11 && pin.length !== 12) {
    return {
      valid: false,
      format: null,
      suffix: null,
      error: `A PIN is 11 or 12 characters. This one is ${pin.length}. Example: 20074 45001, 10025C01001, or 10011 02012C.`,
    }
  }

  const separator = pin.charAt(5)
  if (!/[ A-Z]/.test(separator)) {
    return {
      valid: false,
      format: null,
      suffix: null,
      error: 'Character 6 must be a space or a letter. Example: 20074 45001 or 10025C01001.',
    }
  }

  return {
    valid: false,
    format: null,
    suffix: null,
    error:
      'Characters 1 to 5 and 7 to 11 must all be digits, with an optional letter at the end. Example: 20074 45001 or 10011 02012C.',
  }
}

export function isValidPin(input: string): boolean {
  return validatePin(input).valid
}

export type Jurisdiction = 'City of Savannah' | 'Unincorporated Chatham County'

/**
 * Jurisdiction is derived from the PIN, never entered by hand. A leading 2 is
 * City of Savannah, a leading 1 is unincorporated Chatham County.
 *
 * Returns null for anything else, including an invalid PIN, because guessing
 * a jurisdiction is worse than showing none.
 */
export function deriveJurisdiction(input: string): Jurisdiction | null {
  const pin = normalizePin(input)
  if (!isValidPin(pin)) return null

  switch (pin.charAt(0)) {
    case '2':
      return 'City of Savannah'
    case '1':
      return 'Unincorporated Chatham County'
    default:
      return null
  }
}

/*
  The county also publishes a `Municipality` code on the parcel, so the derived
  jurisdiction can be checked rather than trusted. Only `020` is confirmed
  against real records, so an unrecognised code reports "unknown" instead of
  guessing: a wrong jurisdiction sends a notice to the wrong government.
*/
const MUNICIPALITY_JURISDICTIONS: Record<string, Jurisdiction> = {
  '020': 'City of Savannah',
}

export interface JurisdictionCheck {
  /** Derived from the PIN, which is the rule CLAUDE.md specifies. */
  derived: Jurisdiction | null
  /** From the county `Municipality` code, when that code is one we know. */
  reported: Jurisdiction | null
  /**
   * True when both agree, false when they disagree, and null when the code is
   * unrecognised so there is nothing to compare.
   */
  agrees: boolean | null
}

/**
 * Cross-checks the PIN-derived jurisdiction against the county's own
 * `Municipality` code. A disagreement is worth logging rather than resolving
 * silently, because it means one of the two sources is wrong about a parcel.
 */
export function checkJurisdiction(
  pin: string,
  municipalityCode: string | null | undefined
): JurisdictionCheck {
  const derived = deriveJurisdiction(pin)
  const code = (municipalityCode ?? '').trim()
  const reported = code === '' ? null : (MUNICIPALITY_JURISDICTIONS[code] ?? null)

  return { derived, reported, agrees: reported === null ? null : derived === reported }
}

/**
 * Builds the outbound viewer URL from the template in organization settings.
 *
 * Returns null when there is no template or the PIN is not valid, so the
 * caller renders the PIN as plain text instead of a dead link. Municipal GIS
 * viewers get replatformed, which is why the template is data and not a
 * hardcoded string.
 */
export function buildParcelViewerUrl(template: string | null | undefined, pin: string): string | null {
  if (!template || template.trim() === '') return null
  if (!isValidPin(pin)) return null

  const normalized = normalizePin(pin)

  if (!template.includes('{pin}')) return null

  return template.replace(/\{pin\}/g, encodeURIComponent(normalized))
}
