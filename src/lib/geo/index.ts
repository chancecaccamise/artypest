import centroidOf from '@turf/centroid'
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from 'geojson'

import parcelData from './fixtures/ardsley-parcels.json'
import streetData from './fixtures/ardsley-streets.json'
import { normalizePin } from '@/lib/parcels/pin'
import type { Point } from '@/lib/geocoding/types'

/*
  The geographic data model.

  Parcels are geographic data the county publishes, not entity data the
  association maintains, so they live here keyed by PIN and are joined to
  property records on that key. That is the same key the parcel import matches
  on, so nothing needs a second identifier.

  Geometry is never written by the application. A wrong boundary is a county
  correction, not an edit in this product.
*/

export interface ParcelProperties {
  pin: string
  /** Present on the pool lot and the retention pond. Purely descriptive. */
  commonArea?: string
}

/*
  Both shapes occur in county data. 21 of the harvested corridor's 10,399 lots
  are MultiPolygons: a lot split by a lane, or one wrapping a corner.
*/
export type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelProperties>

export interface StreetProperties {
  name: string
  /*
    From the county's Census feature class code: A2 and A3 are arterials, drawn
    heavier than the residential streets around the lots. The earlier values,
    branch and cul_de_sac and boundary, described the synthetic subdivision that
    the generated fixture invented and appear in no real data.
  */
  classification: 'through' | 'local'
}

export type StreetFeature = Feature<LineString, StreetProperties>

export const PARCELS = parcelData as FeatureCollection<Polygon, ParcelProperties>
export const STREETS = streetData as FeatureCollection<LineString, StreetProperties>

/** Parcel features keyed by normalised PIN, which is how records join to them. */
const BY_PIN = new Map<string, ParcelFeature>(
  PARCELS.features.map((feature) => [normalizePin(feature.properties.pin), feature])
)

const CENTROIDS = new Map<string, Point>(
  [...BY_PIN.entries()].map(([pin, feature]) => {
    const [longitude, latitude] = centroidOf(feature).geometry.coordinates
    return [pin, [longitude ?? 0, latitude ?? 0] as Point]
  })
)

export function parcelForPin(pin: string | null | undefined): ParcelFeature | null {
  if (!pin) return null
  return BY_PIN.get(normalizePin(pin)) ?? null
}

/** The point a lot resolves to. Null when no parcel is on file for the PIN. */
export function centroidForPin(pin: string | null | undefined): Point | null {
  if (!pin) return null
  return CENTROIDS.get(normalizePin(pin)) ?? null
}

export function hasGeometry(pin: string | null | undefined): boolean {
  return parcelForPin(pin) !== null
}

/** Every PIN the plat can draw. */
export function platPins(): string[] {
  return [...BY_PIN.keys()]
}

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/** The extent of the platted area, used to tell "off the plat" from "unplaced". */
export const PLAT_BOUNDS: Bounds = (() => {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  for (const feature of PARCELS.features) {
    for (const ring of feature.geometry.coordinates) {
      for (const [longitude, latitude] of ring) {
        if (longitude === undefined || latitude === undefined) continue
        west = Math.min(west, longitude)
        east = Math.max(east, longitude)
        south = Math.min(south, latitude)
        north = Math.max(north, latitude)
      }
    }
  }

  return { west, south, east, north }
})()

/**
 * Whether a point falls inside the platted area, with a small margin so a
 * vendor office just across the boundary street still draws.
 */
export function isWithinPlat(point: Point, marginDegrees = 0.0006): boolean {
  const [longitude, latitude] = point
  return (
    longitude >= PLAT_BOUNDS.west - marginDegrees &&
    longitude <= PLAT_BOUNDS.east + marginDegrees &&
    latitude >= PLAT_BOUNDS.south - marginDegrees &&
    latitude <= PLAT_BOUNDS.north + marginDegrees
  )
}
