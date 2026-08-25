import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import centroid from '@turf/centroid'
import type { Feature, Polygon, MultiPolygon } from 'geojson'

import { isValidPin, normalizePin } from './pin'
import type { MailingAddress, ParcelRecord, ParcelService } from './types'

/*
  The live SAGIS implementation.

  SAGIS is a public ArcGIS Server with no authentication and no API key, and it
  reflects the request origin in its CORS headers, so this runs in the browser
  with no proxy. See docs/SAGIS-API.md for the field inventory and for the three
  things the fixture used to get wrong.

  Two behaviours here are not obvious from the endpoint documentation:

    Zoning is not a field on the parcel. It comes from intersecting the parcel
    against the zoning district layer. That layer sits under a Savannah path but
    covers the whole county, including unincorporated land and the other
    municipalities, so null means the parcel fell outside every district rather
    than that it is county land.

    The server caps a response by payload size as well as by record count. A
    request for 60 parcels with geometry returns 53 and sets
    exceededTransferLimit, so anything that needs a known number of rows has to
    page and de-duplicate rather than trust resultRecordCount.
*/

const DEFAULT_BASE_URL = 'https://pub.sagis.org/arcgis/rest/services'

/** "Parcel Digest 2025". Attributes plus geometry, 125,326 features. */
const PARCEL_LAYER = 'OpenData/Parcels/FeatureServer/27'

/**
 * Zoning districts. Polygons with no PIN on them, so this is a spatial join.
 *
 * The path says Savannah, but the layer covers the whole county: 1,846 polygons
 * and 285 distinct codes, mixing post-NewZO city codes like RSF-6 with older
 * county codes like R-1 and PUD. Treat the code as free text.
 */
const ZONING_LAYER = 'Savannah/ZoningDevelopment_Map/MapServer/6'

const PARCEL_FIELDS = [
  'PIN',
  'Owner',
  'Owner2',
  'Mailing_Address',
  'Mailing_City',
  'Mailing_State',
  'Mailing_Zip',
  'PropAddress_Full',
  'Municipality',
  'Property_Use',
  'Acres',
  'YearBuilt',
  'FairMarketValue',
  'Total_Assessment',
  'Legal_Description',
  'Date_Updated',
  'Sale_Price',
  'Sale_YY',
  'Sale_MM',
  'Sale_DD',
  'Sale_Quality',
].join(',')

/**
 * The server's own page size. Requests are kept under it, and paging still
 * checks what actually came back.
 */
const PAGE_SIZE = 50

/** How many PINs go into one `IN (...)` clause. Keeps URLs a sane length. */
const PIN_CHUNK_SIZE = 25

interface ParcelProperties {
  PIN?: string | null
  Owner?: string | null
  Owner2?: string | null
  Mailing_Address?: string | null
  Mailing_City?: string | null
  Mailing_State?: string | null
  Mailing_Zip?: string | null
  PropAddress_Full?: string | null
  Municipality?: string | null
  Property_Use?: string | null
  Acres?: number | null
  YearBuilt?: number | null
  FairMarketValue?: number | null
  Total_Assessment?: number | null
  Legal_Description?: string | null
  Date_Updated?: number | null
  Sale_Price?: number | null
  Sale_YY?: number | null
  Sale_MM?: number | null
  Sale_DD?: number | null
  Sale_Quality?: string | null
}

interface ZoningProperties {
  ZONE?: string | null
  ZONING_DISTRICT?: string | null
}

type ParcelFeature = Feature<Polygon | MultiPolygon | null, ParcelProperties>
type ZoningFeature = Feature<Polygon | MultiPolygon, ZoningProperties>

interface FeatureCollectionResponse<T> {
  features?: T[]
  error?: { message?: string }
  properties?: { exceededTransferLimit?: boolean }
  exceededTransferLimit?: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalText(value: unknown): string | null {
  const result = text(value)
  return result === '' ? null : result
}

/** The county publishes epoch milliseconds and no assessment year. */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function mailingFrom(properties: ParcelProperties): MailingAddress {
  return {
    street: text(properties.Mailing_Address),
    city: text(properties.Mailing_City),
    state: text(properties.Mailing_State),
    zip: text(properties.Mailing_Zip),
  }
}

/**
 * A PIN is only ever interpolated into a where clause after validation, and
 * the quote escaping is belt and braces on top of that.
 */
function quote(pin: string): string {
  return `'${pin.replace(/'/g, "''")}'`
}

export interface SagisParcelServiceOptions {
  /**
   * Overridable because municipal GIS gets replatformed, which is the same
   * reason the outbound viewer URL is a template in organization settings
   * rather than a constant.
   */
  baseUrl?: string
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

class SagisParcelService implements ParcelService {
  readonly kind = 'sagis' as const
  readonly connected = true

  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: SagisParcelServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async getByPin(pin: string): Promise<ParcelRecord | null> {
    const { found } = await this.getManyByPin([pin])
    return found[0] ?? null
  }

  async getManyByPin(pins: string[]): Promise<{ found: ParcelRecord[]; missing: string[] }> {
    const wanted: string[] = []
    const missing: string[] = []
    const seen = new Set<string>()

    for (const raw of pins) {
      const key = normalizePin(raw)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      // An unparseable PIN is reported missing rather than sent to the server,
      // which would return nothing and cost a round trip to find that out.
      if (isValidPin(key)) wanted.push(key)
      else missing.push(key)
    }

    if (wanted.length === 0) return { found: [], missing }

    const features: ParcelFeature[] = []
    for (let index = 0; index < wanted.length; index += PIN_CHUNK_SIZE) {
      const chunk = wanted.slice(index, index + PIN_CHUNK_SIZE)
      features.push(
        ...(await this.queryPaged<ParcelFeature>(PARCEL_LAYER, {
          where: `PIN IN (${chunk.map(quote).join(',')})`,
          outFields: PARCEL_FIELDS,
          returnGeometry: 'true',
        }))
      )
    }

    const zoning = await this.zoningFor(features)

    const byPin = new Map<string, ParcelRecord>()
    for (const feature of features) {
      const pin = text(feature.properties?.PIN)
      if (pin === '') continue
      const key = normalizePin(pin)
      // Pages can overlap, so the same parcel can arrive twice.
      if (!byPin.has(key)) byPin.set(key, toParcelRecord(feature, zoning))
    }

    const found: ParcelRecord[] = []
    for (const key of wanted) {
      const record = byPin.get(key)
      if (record) found.push(record)
      else missing.push(key)
    }

    return { found, missing }
  }

  listAll(): Promise<ParcelRecord[]> {
    /*
      Deliberate. There are 125,326 parcels in Chatham County behind a page
      limit, so this is not an operation, it is an outage. The interface says so
      and the user interface reads `kind` to hide the option that calls it.
    */
    return Promise.reject(
      new Error(
        'SAGIS has no endpoint for every parcel in the county. Look parcels up by PIN instead.'
      )
    )
  }

  /**
   * Resolves zoning for a batch in one request: fetch the districts covering
   * the parcels' extent, then test each parcel's centroid locally. One request
   * per batch rather than one per parcel.
   */
  private async zoningFor(features: ParcelFeature[]): Promise<ZoningFeature[]> {
    const extent = extentOf(features)
    if (!extent) return []

    return this.queryPaged<ZoningFeature>(ZONING_LAYER, {
      geometry: `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ZONE,ZONING_DISTRICT',
      returnGeometry: 'true',
    })
  }

  private async queryPaged<T>(layer: string, params: Record<string, string>): Promise<T[]> {
    const collected: T[] = []
    let offset = 0

    // Bounded so a server that keeps saying "there is more" cannot spin forever.
    for (let page = 0; page < 40; page += 1) {
      const body = await this.query<T>(layer, {
        ...params,
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
      })

      const features = body.features ?? []
      collected.push(...features)

      const more = body.exceededTransferLimit ?? body.properties?.exceededTransferLimit ?? false
      if (features.length === 0 || !more) break
      offset += features.length
    }

    return collected
  }

  private async query<T>(
    layer: string,
    params: Record<string, string>
  ): Promise<FeatureCollectionResponse<T>> {
    const search = new URLSearchParams({ outSR: '4326', f: 'geojson', ...params })
    const url = `${this.baseUrl}/${layer}/query?${search.toString()}`

    const response = await this.fetchImpl(url)
    if (!response.ok) {
      throw new Error(`SAGIS returned ${String(response.status)} for ${layer}`)
    }

    const body = (await response.json()) as FeatureCollectionResponse<T>
    if (body.error) {
      throw new Error(`SAGIS rejected the query on ${layer}: ${body.error.message ?? 'no reason given'}`)
    }

    return body
  }
}

interface Extent {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

function extentOf(features: ParcelFeature[]): Extent | null {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity

  for (const feature of features) {
    const geometry = feature.geometry
    if (!geometry) continue
    const rings =
      geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (typeof x !== 'number' || typeof y !== 'number') continue
        if (x < xmin) xmin = x
        if (y < ymin) ymin = y
        if (x > xmax) xmax = x
        if (y > ymax) ymax = y
      }
    }
  }

  if (!Number.isFinite(xmin) || !Number.isFinite(ymin)) return null
  return { xmin, ymin, xmax, ymax }
}

/**
 * The zoning district a parcel sits in, or null.
 *
 * Null means the parcel sits outside every district polygon. That is rare: the
 * layer covers the county, not just the city. It still must not be presented as
 * a missing value.
 */
export function zoningDistrictFor(
  feature: ParcelFeature,
  districts: readonly ZoningFeature[]
): string | null {
  if (!feature.geometry) return null

  const point = centroid(feature as Feature<Polygon | MultiPolygon>)
  for (const district of districts) {
    if (!district.geometry) continue
    try {
      if (booleanPointInPolygon(point, district)) return optionalText(district.properties?.ZONE)
    } catch {
      // One malformed district polygon should not fail the whole lookup.
    }
  }

  return null
}

/**
 * The last recorded transfer, as an ISO date.
 *
 * The county publishes the parts separately, with a four digit year, so there
 * is no century to guess at. A year of zero or absent means no transfer has
 * been recorded, which is a fact rather than a gap.
 *
 * Kept in step with the same function in scripts/sagis/harvest.mjs: the live
 * service and the harvest must produce identical records, or a lot read one way
 * would differ from the same lot read the other.
 */
export function saleDate(year: unknown, month: unknown, day: unknown): string | null {
  const y = typeof year === 'number' ? year : Number.NaN
  const m = typeof month === 'number' ? month : Number.NaN
  const d = typeof day === 'number' ? day : Number.NaN
  if (!Number.isFinite(y) || y <= 0) return null
  if (!Number.isFinite(m) || m < 1 || m > 12) return null
  if (!Number.isFinite(d) || d < 1 || d > 31) return null

  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  // An impossible date such as a 31st of February is normalised by Date into
  // the next month rather than rejected, so it is round tripped to catch it.
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso
}

/** Maps one county feature onto the shape the rest of the app reads. */
export function toParcelRecord(
  feature: ParcelFeature,
  districts: readonly ZoningFeature[]
): ParcelRecord {
  const properties = feature.properties ?? {}

  return {
    pin: text(properties.PIN),
    situsAddress: text(properties.PropAddress_Full),
    ownerName: text(properties.Owner),
    ownerName2: optionalText(properties.Owner2),
    ownerMailingAddress: mailingFrom(properties),
    acreage: num(properties.Acres),
    zoningDistrict: zoningDistrictFor(feature, districts),
    propertyUseCode: optionalText(properties.Property_Use),
    fairMarketValue: num(properties.FairMarketValue),
    totalAssessment: num(properties.Total_Assessment),
    yearBuilt:
      typeof properties.YearBuilt === 'number' && properties.YearBuilt > 0
        ? properties.YearBuilt
        : null,
    legalDescription: text(properties.Legal_Description),
    municipalityCode: optionalText(properties.Municipality),
    dateUpdated: isoDate(properties.Date_Updated),
    lastSaleDate: saleDate(properties.Sale_YY, properties.Sale_MM, properties.Sale_DD),
    // Null rather than zero: a third of transfers carry no price, because a
    // gift and a foreclosure are transfers with no consideration.
    lastSalePrice: num(properties.Sale_Price) > 0 ? num(properties.Sale_Price) : null,
    saleQualityCode: optionalText(properties.Sale_Quality),
  }
}

export function createSagisParcelService(options?: SagisParcelServiceOptions): ParcelService {
  return new SagisParcelService(options)
}
