/*
  The geocoding seam.

  Geocoding is a data operation, so the usual pattern applies: an interface, a
  fixture implementation, and a single swap point.

  The real implementation is SagisGeocodingService, against the county's own
  address locator. There is no MapboxGeocodingService and there should not be:
  for Chatham County addresses the county's locator is the authoritative source
  rather than an approximation of one, and it needs no token. Mapbox is still
  wanted for a satellite basemap, which is a different job.
*/

/** Longitude first, as GeoJSON requires. */
export type Point = [longitude: number, latitude: number]

export interface GeocodeResult {
  point: Point
  /** The address as the service matched it, which may be tidier than the input. */
  matchedAddress: string
}

export interface GeocodingService {
  /** `fixture` while a lookup table answers, `sagis` once the locator does. */
  readonly kind: 'fixture' | 'sagis'

  /**
   * A point for an address, or null when the service does not know it.
   *
   * Null is a normal answer, not a failure. Plenty of owner addresses are out
   * of county and have no place on the plat, and the correct behaviour is to
   * leave the record unplaced rather than to guess at a location a board might
   * post a notice to.
   */
  lookup(address: string | null | undefined): Promise<GeocodeResult | null>

  /** Several at once. Same contract, one entry per input, nulls preserved. */
  lookupMany(addresses: (string | null | undefined)[]): Promise<(GeocodeResult | null)[]>
}
