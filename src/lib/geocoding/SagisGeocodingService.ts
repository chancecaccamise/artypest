import type { GeocodeResult, GeocodingService, Point } from './types'

/*
  The county's own address locator.

  https://pub.sagis.org/arcgis/rest/services/Locators/MAD_PointAddress_Centerlines/GeocodeServer

  No token, no quota, and no proxy: the server reflects the request origin in
  its CORS headers. For a Chatham County address this is the authoritative
  source rather than an approximation of one, which is why there is no Mapbox
  geocoder here. See docs/SAGIS-API.md.

  The locator's native spatial reference is 2239, so every request asks for 4326
  and gets WGS84 back.
*/

const DEFAULT_BASE_URL = 'https://pub.sagis.org/arcgis/rest/services'
const LOCATOR = 'Locators/MAD_PointAddress_Centerlines/GeocodeServer'

/**
 * Below this, a candidate is a wrong answer wearing a right answer's clothes.
 * A real match on a real address scores in the high nineties: `7 E 46TH ST,
 * SAVANNAH, GA` comes back at 98.89.
 *
 * Placing a record at a guessed point is worse than leaving it unplaced,
 * because a board posts notices to what the map says.
 */
const MINIMUM_SCORE = 80

interface Candidate {
  address?: string | null
  score?: number | null
  location?: { x?: number | null; y?: number | null } | null
}

interface CandidateResponse {
  candidates?: Candidate[]
  error?: { message?: string }
}

export interface SagisGeocodingServiceOptions {
  baseUrl?: string
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Raise it to be stricter. Lowering it is almost always the wrong fix. */
  minimumScore?: number
}

/** Picks the best usable candidate, or nothing. */
export function bestCandidate(
  candidates: readonly Candidate[],
  minimumScore = MINIMUM_SCORE
): GeocodeResult | null {
  let best: GeocodeResult | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const score = candidate.score
    const x = candidate.location?.x
    const y = candidate.location?.y

    if (typeof score !== 'number' || score < minimumScore) continue
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (score <= bestScore) continue

    bestScore = score
    // Longitude first, as GeoJSON requires.
    const point: Point = [x, y]
    best = { point, matchedAddress: (candidate.address ?? '').trim() }
  }

  return best
}

class SagisGeocodingService implements GeocodingService {
  readonly kind = 'sagis' as const

  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly minimumScore: number
  /** One address is often asked for repeatedly across a plat render. */
  private readonly cache = new Map<string, GeocodeResult | null>()

  constructor(options: SagisGeocodingServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.minimumScore = options.minimumScore ?? MINIMUM_SCORE
  }

  async lookup(address: string | null | undefined): Promise<GeocodeResult | null> {
    const query = (address ?? '').trim()
    if (query === '') return null

    const cached = this.cache.get(query)
    if (cached !== undefined) return cached

    const result = await this.request(query)
    this.cache.set(query, result)
    return result
  }

  /**
   * Sequential on purpose. This is a municipal server doing the county a
   * favour, and a plat render can ask for a hundred addresses at once.
   */
  async lookupMany(
    addresses: (string | null | undefined)[]
  ): Promise<(GeocodeResult | null)[]> {
    const results: (GeocodeResult | null)[] = []
    for (const address of addresses) {
      results.push(await this.lookup(address))
    }
    return results
  }

  private async request(address: string): Promise<GeocodeResult | null> {
    const search = new URLSearchParams({ SingleLine: address, outSR: '4326', f: 'pjson' })
    const url = `${this.baseUrl}/${LOCATOR}/findAddressCandidates?${search.toString()}`

    const response = await this.fetchImpl(url)
    if (!response.ok) {
      throw new Error(`The SAGIS locator returned ${String(response.status)}`)
    }

    const body = (await response.json()) as CandidateResponse
    if (body.error) {
      throw new Error(`The SAGIS locator rejected the request: ${body.error.message ?? 'no reason given'}`)
    }

    // An address the locator does not know is a normal answer, not a failure.
    return bestCandidate(body.candidates ?? [], this.minimumScore)
  }
}

export function createSagisGeocodingService(
  options?: SagisGeocodingServiceOptions
): GeocodingService {
  return new SagisGeocodingService(options)
}
