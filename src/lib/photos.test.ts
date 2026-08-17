import { describe, expect, it } from 'vitest'

import {
  approximateBytes,
  fitWithin,
  initialsFor,
  MAX_DIMENSION,
  validatePhotoFile,
} from './photos'

describe('fitWithin', () => {
  it('scales a phone photograph down to the long edge', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 320, height: 240 })
  })

  it('handles portrait as well as landscape', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 240, height: 320 })
  })

  it('leaves an image that is already small alone', () => {
    // Scaling up produces a blurrier version of the same thing.
    expect(fitWithin(120, 90)).toEqual({ width: 120, height: 90 })
  })

  it('never returns a zero dimension', () => {
    // A one pixel tall banner would otherwise round to nothing and draw blank.
    expect(fitWithin(4000, 1).height).toBeGreaterThan(0)
    expect(fitWithin(0, 0).width).toBeGreaterThan(0)
  })

  it('keeps the long edge at the limit', () => {
    const fitted = fitWithin(2000, 1000)
    expect(Math.max(fitted.width, fitted.height)).toBe(MAX_DIMENSION)
  })
})

describe('validatePhotoFile', () => {
  const file = (type: string, size: number) =>
    ({ type, size, name: 'photo' }) as File

  it('accepts the formats a phone or a scanner produces', () => {
    expect(validatePhotoFile(file('image/jpeg', 2_000_000))).toBeNull()
    expect(validatePhotoFile(file('image/png', 2_000_000))).toBeNull()
  })

  it('refuses a file that is not an image, before reading it', () => {
    // A video picked by accident would otherwise become a 40MB data URL.
    expect(validatePhotoFile(file('video/mp4', 1000))?.kind).toBe('type')
    expect(validatePhotoFile(file('application/pdf', 1000))?.kind).toBe('type')
  })

  it('refuses something implausibly large', () => {
    expect(validatePhotoFile(file('image/jpeg', 40 * 1024 * 1024))?.kind).toBe('size')
  })

  it('says what to do, not just that something is wrong', () => {
    expect(validatePhotoFile(file('video/mp4', 1000))?.message).toMatch(/JPEG/)
  })
})

describe('approximateBytes', () => {
  it('accounts for base64 being a third larger than the bytes it carries', () => {
    // 4 base64 characters carry 3 bytes.
    expect(approximateBytes('data:image/jpeg;base64,AAAA')).toBe(3)
  })

  it('returns nothing for a string that is not a data URL', () => {
    expect(approximateBytes('not a data url')).toBe(0)
  })
})

describe('initialsFor', () => {
  it('takes the first and last name', () => {
    expect(initialsFor('Meredith Cantwell')).toBe('MC')
    expect(initialsFor('Daniel J Seidman')).toBe('DS')
  })

  it('handles a single name', () => {
    expect(initialsFor('Chance')).toBe('CH')
  })

  it('ignores punctuation that is not a name', () => {
    expect(initialsFor('  Jane   Keener-Mackenzie  ')).toBe('JK')
  })

  it('never returns an empty label', () => {
    expect(initialsFor('')).toBe('?')
    expect(initialsFor('   ')).toBe('?')
  })
})
