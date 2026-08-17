import { describe, expect, it } from 'vitest'

import {
  buildParcelViewerUrl,
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
    expect(validatePin('2003263001').error).toContain('11 characters')
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
