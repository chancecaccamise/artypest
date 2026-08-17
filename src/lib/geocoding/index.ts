import { createFixtureGeocodingService } from './FixtureGeocodingService'
import type { GeocodingService } from './types'

/*
  The single swap point.

  When a Mapbox token exists, MapboxGeocodingService lands next to
  FixtureGeocodingService and this one line changes. Nothing else in the app
  names a geocoding source.
*/
export const geocodingService: GeocodingService = createFixtureGeocodingService()

export { geocodeSync, normalizeAddress } from './FixtureGeocodingService'
export type { GeocodeResult, GeocodingService, Point } from './types'
