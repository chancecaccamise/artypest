import { describe, expect, it } from 'vitest'

import { createSagisGeocodingService } from '@/lib/geocoding/SagisGeocodingService'

import { createSagisParcelService } from './SagisParcelService'

/*
  The one test in this repo that touches the network.

  Skipped unless VITE_SAGIS_SMOKE is set, so `pnpm verify` stays offline and
  deterministic:

    VITE_SAGIS_SMOKE=1 pnpm exec vitest run src/lib/parcels/SagisParcelService.live.test.ts

  It exists because every other test here asserts against a recorded payload,
  and a recording cannot tell you the service changed. This one can.

  PIN 20074 45001 is 7 E 46th St in Savannah, owned by WILSON C V VAN, zoned
  RSF-6, 0.2 acres. If any of that changes the county changed it, and the
  failure is information rather than a bug.
*/
const live = import.meta.env.VITE_SAGIS_SMOKE === '1'

describe.skipIf(!live)('SAGIS, live', () => {
  it('reads a known parcel with its zoning', async () => {
    const service = createSagisParcelService()
    const record = await service.getByPin('20074 45001')

    expect(record).not.toBeNull()
    expect(record?.situsAddress).toBe('7 E 46TH ST')
    expect(record?.ownerName).toBe('WILSON C V VAN')
    expect(record?.acreage).toBeCloseTo(0.2, 2)
    // Not a field on the parcel. This is the spatial join working.
    expect(record?.zoningDistrict).toBe('RSF-6')
    expect(record?.municipalityCode).toBe('020')
    // Georgia assesses at 40% of fair market value.
    expect(record?.totalAssessment).toBe(Math.round((record?.fairMarketValue ?? 0) * 0.4))
  }, 30_000)

  it('accepts the 12-character PIN format that used to be rejected', async () => {
    const service = createSagisParcelService()
    // 106 San Marco Dr: a space separator and a trailing letter.
    const record = await service.getByPin('10011 02012C')

    expect(record?.pin).toBe('10011 02012C')
    /*
      Unincorporated county land, and it still has a zoning district. This
      assertion originally expected null, on the reading that the layer was
      City of Savannah only. It is not, and this test failing is what corrected
      the documentation. County codes are the older format, not post-NewZO.
    */
    expect(record?.zoningDistrict).toBe('R-1')
  }, 30_000)

  it('reports a PIN that does not exist as missing', async () => {
    const service = createSagisParcelService()
    const result = await service.getManyByPin(['20074 45001', '29999 99999'])

    expect(result.found).toHaveLength(1)
    expect(result.missing).toEqual(['29999 99999'])
  }, 30_000)

  it('refuses to list the county', async () => {
    await expect(createSagisParcelService().listAll()).rejects.toThrow()
  })

  it('geocodes a real address through the county locator', async () => {
    const geocoder = createSagisGeocodingService()
    const result = await geocoder.lookup('7 E 46TH ST, SAVANNAH, GA')

    expect(result).not.toBeNull()
    // Longitude first, and inside Chatham County.
    expect(result?.point[0]).toBeCloseTo(-81.1027, 2)
    expect(result?.point[1]).toBeCloseTo(32.05, 2)
  }, 30_000)

  it('leaves an address the county does not know unplaced', async () => {
    const geocoder = createSagisGeocodingService()
    expect(await geocoder.lookup('1 Nonexistent Plaza, Fairbanks, AK')).toBeNull()
  }, 30_000)
})
