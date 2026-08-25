import { describe, expect, it } from 'vitest'

import { saleDate } from './SagisParcelService'
import sample from './fixtures/chatham-sample.json'
import type { ParcelRecord } from './types'

/*
  The last recorded transfer.

  The county publishes the parts separately: a four digit year, a month and a
  day, each its own small integer. Measured across the harvested extent, 94% of
  parcels carry a year and every one of those carries a month and a day, so a
  partial date is not a case that occurs. The awkward cases are the impossible
  ones and the absent ones.
*/
describe('reading a sale date off the county roll', () => {
  it('builds an ISO date from the three parts', () => {
    expect(saleDate(2022, 4, 11)).toBe('2022-04-11')
    expect(saleDate(1990, 2, 1)).toBe('1990-02-01')
  })

  it('pads a single digit month and day', () => {
    expect(saleDate(2011, 5, 9)).toBe('2011-05-09')
  })

  it('reads a four digit year as written, with no century to guess', () => {
    // Real dates on this roll run back to 1912.
    expect(saleDate(1912, 11, 11)).toBe('1912-11-11')
  })

  it('returns nothing when no transfer has been recorded', () => {
    // A fact about the parcel, not a gap in the data.
    expect(saleDate(0, 0, 0)).toBeNull()
    expect(saleDate(null, null, null)).toBeNull()
    expect(saleDate(undefined, undefined, undefined)).toBeNull()
  })

  it('refuses a month or day outside the calendar', () => {
    expect(saleDate(2020, 13, 1)).toBeNull()
    expect(saleDate(2020, 0, 1)).toBeNull()
    expect(saleDate(2020, 1, 32)).toBeNull()
    expect(saleDate(2020, 1, 0)).toBeNull()
  })

  it('refuses a date that does not exist, rather than rolling it forward', () => {
    /*
      Date turns the 31st of February into the 2nd or 3rd of March rather than
      rejecting it, which would file a transfer on a day it did not happen.
    */
    expect(saleDate(2021, 2, 31)).toBeNull()
    expect(saleDate(2021, 4, 31)).toBeNull()
    // A real leap day is kept.
    expect(saleDate(2020, 2, 29)).toBe('2020-02-29')
    expect(saleDate(2021, 2, 29)).toBeNull()
  })

  it('ignores a value that is not a number', () => {
    expect(saleDate('2020', '1', '1')).toBeNull()
  })
})

const CHATHAM_SAMPLE: ParcelRecord[] = sample

describe('the committed sample carries real sale history', () => {
  it('has a date on almost every parcel', () => {
    const dated = CHATHAM_SAMPLE.filter((parcel) => parcel.lastSaleDate !== null)
    expect(dated.length).toBeGreaterThan(CHATHAM_SAMPLE.length * 0.9)
  })

  it('never records a price of zero, only an absent one', () => {
    /*
      A third of recorded transfers carry no price, because a gift, a family
      transfer and a foreclosure are transfers with no consideration. Zero would
      read as "sold for nothing" and would drag any average down with it.
    */
    for (const parcel of CHATHAM_SAMPLE) {
      expect(parcel.lastSalePrice === null || parcel.lastSalePrice > 0).toBe(true)
    }
  })

  it('carries the qualification code beside the price', () => {
    // The price should never be read as a market value without it.
    const priced = CHATHAM_SAMPLE.filter((parcel) => parcel.lastSalePrice !== null)
    expect(priced.length).toBeGreaterThan(0)
    for (const parcel of priced) {
      expect(parcel.saleQualityCode).not.toBe('')
    }
  })

  it('reads every date back as the date it says it is', () => {
    for (const parcel of CHATHAM_SAMPLE) {
      if (parcel.lastSaleDate === null) continue
      expect(parcel.lastSaleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${parcel.lastSaleDate}T00:00:00.000Z`).toISOString().slice(0, 10)).toBe(
        parcel.lastSaleDate
      )
    }
  })
})
