import table from './fixtures/savannah-addresses.json'
import type { GeocodeResult, GeocodingService, Point } from './types'

/*
  A flat lookup table of address to coordinate. No network, no key, no quota.

  Addresses that are not in the table return null, which is the whole point:
  every out-of-county owner mailing address is absent on purpose, so the
  unplaced tray and the manual placement control are exercised by the demo data
  rather than only by a hypothetical.
*/

/*
  JSON widens every coordinate pair to number[], so the assertion goes through
  unknown. The generator writes exactly two numbers per entry and the shape is
  checked by a test, which is a better guarantee than a cast that only looks
  safer.
*/
const TABLE = table as unknown as Record<string, Point>

/**
 * Uppercases, strips commas and periods, and collapses whitespace.
 *
 * `scripts/generate-geocoding-fixture.mjs` applies exactly this before writing
 * a key. If one changes, the other has to change with it, which is why the
 * rule is written down in both places rather than assumed.
 */
export function normalizeAddress(input: string): string {
  return input
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

class FixtureGeocodingService implements GeocodingService {
  readonly kind = 'fixture' as const

  lookup(address: string | null | undefined): Promise<GeocodeResult | null> {
    return Promise.resolve(this.lookupSync(address))
  }

  lookupMany(addresses: (string | null | undefined)[]): Promise<(GeocodeResult | null)[]> {
    return Promise.resolve(addresses.map((address) => this.lookupSync(address)))
  }

  /**
   * The synchronous form the location cascade uses.
   *
   * The cascade runs for every record on every render of the map, so it cannot
   * be asynchronous without turning one resolution into a waterfall of promises.
   * A real geocoder will be called ahead of time and its answers cached onto
   * the records; this method is what that cache will read from.
   */
  private lookupSync(address: string | null | undefined): GeocodeResult | null {
    if (!address || address.trim() === '') return null

    const key = normalizeAddress(address)
    const point = TABLE[key]
    if (!point) return null

    return { point, matchedAddress: key }
  }
}

export function createFixtureGeocodingService(): GeocodingService {
  return new FixtureGeocodingService()
}

/**
 * A synchronous lookup, for the location cascade.
 *
 * Kept as a plain function rather than a method so the cascade stays a pure
 * function of its inputs and can be tested without constructing a service.
 */
export function geocodeSync(address: string | null | undefined): Point | null {
  if (!address || address.trim() === '') return null
  return TABLE[normalizeAddress(address)] ?? null
}
