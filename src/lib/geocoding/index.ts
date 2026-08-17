import { createFixtureGeocodingService } from './FixtureGeocodingService'
import { createSagisGeocodingService } from './SagisGeocodingService'
import type { GeocodingService } from './types'

/*
  The single swap point. Nothing else in the app names a geocoding source.

  The county's own locator needs no token, so it is the real implementation and
  there is no Mapbox geocoder. It is opt-in behind the same flag as the parcel
  service, so the demo and the tests stay offline and deterministic.
*/
function createGeocodingService(): GeocodingService {
  if (import.meta.env.VITE_SAGIS_LIVE !== 'true') return createFixtureGeocodingService()

  const baseUrl = import.meta.env.VITE_SAGIS_BASE_URL ?? ''
  return createSagisGeocodingService(baseUrl === '' ? {} : { baseUrl })
}

export const geocodingService: GeocodingService = createGeocodingService()

export { geocodeSync, normalizeAddress } from './FixtureGeocodingService'
export { createSagisGeocodingService } from './SagisGeocodingService'
export type { GeocodeResult, GeocodingService, Point } from './types'
