import { describe, expect, it } from 'vitest'

import {
  buildParcelViewerUrl,
  checkJurisdiction,
  deriveJurisdiction,
  isValidPin,
  normalizePin,
  validatePin,
} from './pin'

describe('validatePin', () => {
  it('accepts the spaced form', () => {
    const result = validatePin('20032 63001')
    expect(result.valid).toBe(true)
    expect(result.format).toBe('spaced')
    expect(result.error).toBeNull()
  })

  it('accepts the lettered form, where the letter takes the place of the space', () => {
    const result = validatePin('10993C01034')
    expect(result.valid).toBe(true)
    expect(result.format).toBe('lettered')
  })

  it('accepts every letter in the separator position', () => {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(isValidPin(`10993${letter}01034`)).toBe(true)
    }
  })

  it('normalises before validating: surrounding space, doubled space, lowercase letter', () => {
    expect(isValidPin('  20032 63001  ')).toBe(true)
    expect(isValidPin('20032  63001')).toBe(true)
    expect(isValidPin('10993c01034')).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['2003263001', 'no separator, 10 characters'],
    ['20032-63001', 'hyphen separator'],
    ['20032 6300', 'short tail'],
    ['20032 630012', 'long tail'],
    ['2003 263001', 'separator in the wrong position'],
    ['A0032 63001', 'letter in the head'],
    ['20032 6300A', 'letter in the tail'],
    ['20032.63001', 'period separator'],
  ])('rejects %j (%s)', (input) => {
    const result = validatePin(input)
    expect(result.valid).toBe(false)
    expect(result.format).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('says what is wrong rather than that something is wrong', () => {
    expect(validatePin('2003263001').error).toContain('11 or 12 characters')
    expect(validatePin('20032-63001').error).toContain('space or a letter')
    expect(validatePin('20032 6300A').error).toContain('digits')
  })
})

describe('normalizePin', () => {
  it('trims, collapses whitespace, and uppercases', () => {
    expect(normalizePin('  10993c01034 ')).toBe('10993C01034')
    expect(normalizePin('20032   63001')).toBe('20032 63001')
  })
})

describe('deriveJurisdiction', () => {
  it('reads a leading 2 as City of Savannah', () => {
    expect(deriveJurisdiction('20032 63001')).toBe('City of Savannah')
    expect(deriveJurisdiction('29999C00001')).toBe('City of Savannah')
  })

  it('reads a leading 1 as unincorporated Chatham County', () => {
    expect(deriveJurisdiction('10993C01034')).toBe('Unincorporated Chatham County')
    expect(deriveJurisdiction('10000 00000')).toBe('Unincorporated Chatham County')
  })

  it('returns null rather than guessing for any other leading digit', () => {
    expect(deriveJurisdiction('30032 63001')).toBeNull()
    expect(deriveJurisdiction('00032 63001')).toBeNull()
  })

  it('returns null for an invalid PIN', () => {
    expect(deriveJurisdiction('2003263001')).toBeNull()
    expect(deriveJurisdiction('')).toBeNull()
  })
})

describe('buildParcelViewerUrl', () => {
  const template = 'https://gis.chathamcounty.org/parcel?pin={pin}'

  it('substitutes the normalised PIN', () => {
    expect(buildParcelViewerUrl(template, '10993c01034')).toBe(
      'https://gis.chathamcounty.org/parcel?pin=10993C01034'
    )
  })

  it('encodes the space in the spaced form', () => {
    expect(buildParcelViewerUrl(template, '20032 63001')).toBe(
      'https://gis.chathamcounty.org/parcel?pin=20032%2063001'
    )
  })

  it('substitutes every occurrence of the placeholder', () => {
    expect(buildParcelViewerUrl('https://x.test/{pin}/detail?id={pin}', '20032 63001')).toBe(
      'https://x.test/20032%2063001/detail?id=20032%2063001'
    )
  })

  it('returns null when no template is configured, so the PIN renders as plain text', () => {
    expect(buildParcelViewerUrl(null, '20032 63001')).toBeNull()
    expect(buildParcelViewerUrl('', '20032 63001')).toBeNull()
    expect(buildParcelViewerUrl('   ', '20032 63001')).toBeNull()
  })

  it('returns null when the template has no {pin} placeholder', () => {
    expect(buildParcelViewerUrl('https://gis.chathamcounty.org/', '20032 63001')).toBeNull()
  })

  it('returns null for an invalid PIN rather than linking to a lookup that will fail', () => {
    expect(buildParcelViewerUrl(template, '2003263001')).toBeNull()
  })
})

/*
  Real PIN values from the live SAGIS service. See docs/SAGIS-API.md. The
  12-character form was rejected before this, and it is a real parcel.
*/
describe('real SAGIS PIN formats', () => {
  it('accepts the spaced form', () => {
    const result = validatePin('20074 45001')
    expect(result.valid).toBe(true)
    expect(result.format).toBe('spaced')
    expect(result.suffix).toBeNull()
  })

  it('accepts the lettered form', () => {
    const result = validatePin('10025C01001')
    expect(result.valid).toBe(true)
    expect(result.format).toBe('lettered')
    expect(result.suffix).toBeNull()
  })

  it('accepts a space separator with a trailing letter, which is 12 characters', () => {
    // 106 San Marco Dr. Rejected by the previous 11-character rule.
    const result = validatePin('10011 02012C')
    expect(result.valid).toBe(true)
    expect(result.format).toBe('spaced')
    expect(result.suffix).toBe('C')
  })

  it('keeps the trailing letter, because it identifies a different parcel', () => {
    // Dropping the suffix leaves a valid 11-character PIN, which is exactly why
    // the letter has to be preserved: both are real shapes, for different land.
    expect(isValidPin('10011 02012')).toBe(true)
    expect(normalizePin('10011 02012C')).not.toBe(normalizePin('10011 02012'))
    expect(validatePin('10011 02012').suffix).toBeNull()
    expect(validatePin('10011 02012C').suffix).toBe('C')
  })

  it('derives jurisdiction from the leading digit for all three forms', () => {
    expect(deriveJurisdiction('20074 45001')).toBe('City of Savannah')
    expect(deriveJurisdiction('10025C01001')).toBe('Unincorporated Chatham County')
    expect(deriveJurisdiction('10011 02012C')).toBe('Unincorporated Chatham County')
  })

  it('agrees with the county municipality code on a real Savannah parcel', () => {
    const check = checkJurisdiction('20074 45001', '020')
    expect(check.derived).toBe('City of Savannah')
    expect(check.reported).toBe('City of Savannah')
    expect(check.agrees).toBe(true)
  })

  it('reports unknown rather than guessing on an unrecognised municipality code', () => {
    const check = checkJurisdiction('10025C01001', '999')
    expect(check.derived).toBe('Unincorporated Chatham County')
    expect(check.reported).toBeNull()
    expect(check.agrees).toBeNull()
  })

  it('catches a disagreement between the PIN and the municipality code', () => {
    // A county PIN reported as being in the city is one of the two sources
    // being wrong about a parcel, which is worth surfacing.
    expect(checkJurisdiction('10025C01001', '020').agrees).toBe(false)
  })
})
