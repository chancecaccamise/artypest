/*
  SAGIS PIN handling. Pure functions, no network, no lookup.

  These three are genuinely functional today and are not stubs. Nothing here
  needs the SAGIS API, so nothing here waits for it.
*/

/**
 * A SAGIS PIN is eleven characters: five, then a separator, then five.
 *
 * The separator is a space in the common form (`20032 63001`) or a letter in
 * the split-parcel form (`10993C01034`), where the letter takes the place of
 * the space. Both are valid and both occur in Chatham County data.
 */
const PIN_PATTERN = /^\d{5}(?: |[A-Z])\d{5}$/

export type PinFormat = 'spaced' | 'lettered'

export interface PinValidation {
  valid: boolean
  /** Which of the two valid shapes it is, when valid. */
  format: PinFormat | null
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
    return { valid: false, format: null, error: 'Enter a parcel identification number.' }
  }

  if (PIN_PATTERN.test(pin)) {
    return { valid: true, format: pin.includes(' ') ? 'spaced' : 'lettered', error: null }
  }

  // Say which of the two shapes it missed, and how.
  if (pin.length !== 11) {
    return {
      valid: false,
      format: null,
      error: `A PIN is 11 characters. This one is ${pin.length}. Example: 20032 63001 or 10993C01034.`,
    }
  }

  const separator = pin.charAt(5)
  if (!/[ A-Z]/.test(separator)) {
    return {
      valid: false,
      format: null,
      error: 'Character 6 must be a space or a letter. Example: 20032 63001 or 10993C01034.',
    }
  }

  return {
    valid: false,
    format: null,
    error: 'Characters 1 to 5 and 7 to 11 must all be digits. Example: 20032 63001.',
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
