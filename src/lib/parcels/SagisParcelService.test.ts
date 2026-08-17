import { describe, expect, it, vi } from 'vitest'

import { createSagisParcelService } from './SagisParcelService'

/*
  No network. The payloads below are the real shape the live service returns,
  with the attribute values copied from real records (PIN 20074 45001 is
  7 E 46th St, owner WILSON C V VAN, zoned RSF-6). The polygons are simplified
  squares: the attributes are what this file is testing, and the geometry only
  has to be enough for the zoning point-in-polygon join to mean something.
*/

const PARCEL_FEATURE = {
  type: 'Feature',
  properties: {
    PIN: '20074 45001',
    Owner: 'WILSON C V VAN',
    Owner2: '',
    Mailing_Address: '7 EAST 46TH STREET',
    Mailing_City: 'SAVANNAH',
    Mailing_State: 'GA',
    Mailing_Zip: '31405',
    PropAddress_Full: '7 E 46TH ST',
    Municipality: '020',
    Property_Use: 'R3',
    Acres: 0.2,
    YearBuilt: 1928,
    FairMarketValue: 467600,
    Total_Assessment: 187040,
    Legal_Description: 'W 90 FT LOTS 117 THRU 119 LAWTON  WD',
    Date_Updated: 1746489600000,
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-81.1029, 32.0499],
        [-81.1026, 32.0499],
        [-81.1026, 32.0502],
        [-81.1029, 32.0502],
        [-81.1029, 32.0499],
      ],
    ],
  },
}

const ZONING_FEATURE = {
  type: 'Feature',
  properties: { ZONE: 'RSF-6', ZONING_DISTRICT: 'Residential Single-family-6' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-81.11, 32.04],
        [-81.09, 32.04],
        [-81.09, 32.06],
        [-81.11, 32.06],
        [-81.11, 32.04],
      ],
    ],
  },
}

function collection(features: unknown[], exceededTransferLimit = false) {
  return { type: 'FeatureCollection', features, exceededTransferLimit }
}

/** fetch accepts three input shapes. Only a string is safe to read directly. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function respond(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
}

/** Answers a parcel query and a zoning query by looking at the layer in the URL. */
function stubFetch(
  parcels: unknown[],
  zoning: unknown[] = [ZONING_FEATURE],
  options: { exceedOnce?: boolean } = {}
) {
  let parcelCalls = 0
  const calls: string[] = []

  const impl = vi.fn((input: string | URL | Request) => {
    const url = urlOf(input)
    calls.push(url)

    if (url.includes('ZoningDevelopment_Map')) return respond(collection(zoning))

    parcelCalls += 1
    // The live server caps by payload size, so the first page can come back
    // short with exceededTransferLimit set.
    if (options.exceedOnce && parcelCalls === 1) {
      return respond(collection(parcels, true))
    }
    return respond(collection(parcels))
  })

  return { impl: impl as unknown as typeof fetch, calls }
}

describe('SagisParcelService', () => {
  it('maps a real county record onto ParcelRecord', async () => {
    const { impl } = stubFetch([PARCEL_FEATURE])
    const service = createSagisParcelService({ fetchImpl: impl })

    const record = await service.getByPin('20074 45001')

    expect(record).not.toBeNull()
    expect(record?.pin).toBe('20074 45001')
    // The raw county string, not a cleaned-up one: owner.ts does the parsing.
    expect(record?.ownerName).toBe('WILSON C V VAN')
    expect(record?.ownerName2).toBeNull()
    expect(record?.ownerMailingAddress).toEqual({
      street: '7 EAST 46TH STREET',
      city: 'SAVANNAH',
      state: 'GA',
      zip: '31405',
    })
    expect(record?.propertyUseCode).toBe('R3')
    expect(record?.municipalityCode).toBe('020')
    expect(record?.fairMarketValue).toBe(467600)
    // Georgia assesses at 40% of fair market value.
    expect(record?.totalAssessment).toBe(187040)
    expect(record?.totalAssessment).toBe(record!.fairMarketValue * 0.4)
  })

  it('turns the county epoch milliseconds into an ISO date', async () => {
    const { impl } = stubFetch([PARCEL_FEATURE])
    const service = createSagisParcelService({ fetchImpl: impl })

    expect((await service.getByPin('20074 45001'))?.dateUpdated).toBe('2025-05-06')
  })

  it('resolves zoning by spatial join, because the parcel has no zoning field', async () => {
    const { impl, calls } = stubFetch([PARCEL_FEATURE])
    const service = createSagisParcelService({ fetchImpl: impl })

    const record = await service.getByPin('20074 45001')

    expect(record?.zoningDistrict).toBe('RSF-6')
    // A second request, against a different layer. Zoning is not on the parcel.
    expect(calls.some((url) => url.includes('ZoningDevelopment_Map'))).toBe(true)
  })

  it('reports null zoning for a parcel outside every district', async () => {
    // Rare, since the layer covers the whole county, but null is an answer
    // rather than a missing value.
    const { impl } = stubFetch([PARCEL_FEATURE], [])
    const service = createSagisParcelService({ fetchImpl: impl })

    expect((await service.getByPin('20074 45001'))?.zoningDistrict).toBeNull()
  })

  it('reports an unknown PIN as missing rather than dropping it', async () => {
    const { impl } = stubFetch([PARCEL_FEATURE])
    const service = createSagisParcelService({ fetchImpl: impl })

    const result = await service.getManyByPin(['20074 45001', '29999 99999'])

    expect(result.found.map((record) => record.pin)).toEqual(['20074 45001'])
    expect(result.missing).toEqual(['29999 99999'])
  })

  it('does not spend a request on a PIN that cannot be valid', async () => {
    const { impl, calls } = stubFetch([])
    const service = createSagisParcelService({ fetchImpl: impl })

    const result = await service.getManyByPin(['nonsense'])

    expect(result.missing).toEqual(['NONSENSE'])
    expect(calls).toHaveLength(0)
  })

  it('de-duplicates parcels that arrive on more than one page', async () => {
    // Paging past a payload-size cap can return the same row twice.
    const { impl } = stubFetch([PARCEL_FEATURE], [ZONING_FEATURE], { exceedOnce: true })
    const service = createSagisParcelService({ fetchImpl: impl })

    const result = await service.getManyByPin(['20074 45001'])

    expect(result.found).toHaveLength(1)
    expect(result.missing).toEqual([])
  })

  it('refuses to list the county, and says why', async () => {
    const { impl } = stubFetch([])
    const service = createSagisParcelService({ fetchImpl: impl })

    await expect(service.listAll()).rejects.toThrow(/by PIN/)
  })

  it('says it is the live source, so the interface never claims to be a fixture', () => {
    const { impl } = stubFetch([])
    const service = createSagisParcelService({ fetchImpl: impl })

    expect(service.kind).toBe('sagis')
    expect(service.connected).toBe(true)
  })

  it('surfaces a server error rather than returning an empty result', async () => {
    const impl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) } as Response)
    ) as unknown as typeof fetch
    const service = createSagisParcelService({ fetchImpl: impl })

    await expect(service.getByPin('20074 45001')).rejects.toThrow(/503/)
  })

  it('honours an overridden base URL, because municipal GIS gets replatformed', async () => {
    const { impl, calls } = stubFetch([PARCEL_FEATURE])
    const service = createSagisParcelService({
      fetchImpl: impl,
      baseUrl: 'https://gis.example.gov/arcgis/rest/services/',
    })

    await service.getByPin('20074 45001')

    expect(calls[0]).toContain('https://gis.example.gov/arcgis/rest/services/OpenData/Parcels')
  })
})
