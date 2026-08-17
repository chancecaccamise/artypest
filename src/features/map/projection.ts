import { geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import type { FeatureCollection, Polygon } from 'geojson'

import { PARCELS, STREETS, type ParcelProperties, type StreetProperties } from '@/lib/geo'
import type { Point } from '@/lib/geocoding/types'
import { normalizePin } from '@/lib/parcels/pin'

/*
  Projection and path generation.

  geoMercator with fitSize auto-frames the platted area. At neighbourhood scale
  Mercator distortion is irrelevant, and it is the projection Mapbox uses
  internally, so the parcels will look identical in both views.

  The path strings depend only on geometry and viewport size, never on pan or
  zoom, so they are computed once per size and a transform on the parent group
  handles all navigation. Recomputing path data on every pan frame is the one
  mistake that makes an SVG map feel slow.
*/

export interface ParcelPath {
  pin: string
  d: string
  /** Projected centroid, for the lot label and for pin placement. */
  centroid: [number, number]
  /** Projected area in square pixels, for gating labels on legibility. */
  area: number
  commonArea: string | null
}

export interface StreetPath {
  id: string
  name: string
  classification: StreetProperties['classification']
  d: string
  /** Length in pixels, so a name is only drawn where it fits. */
  length: number
}

export interface PlatProjection {
  width: number
  height: number
  /** Longitude and latitude to screen space, before the zoom transform. */
  project: (point: Point) => [number, number] | null
  /** Screen space back to longitude and latitude, for manual placement. */
  invert: (screen: [number, number]) => Point | null
  parcels: ParcelPath[]
  streets: StreetPath[]
  parcelByPin: Map<string, ParcelPath>
}

/** Breathing room so the outermost lot line is not flush against the edge. */
const PADDING = 16

/*
  d3-geo and RFC 7946 disagree about winding order.

  RFC 7946 wants exterior rings counterclockwise. d3-geo treats geometry as
  spherical with the interior on the right, so it wants them clockwise, and
  renders a counterclockwise ring as everything on the globe except that lot.
  On screen that is a solid block covering the entire plat.

  The stored geometry follows the standard, because it is the permanent asset
  and Mapbox reads it correctly. The reversal lives here instead, in the file
  the Mapbox swap deletes. It runs once at module load, not per render.
*/
const D3_PARCELS: FeatureCollection<Polygon, ParcelProperties> = {
  type: 'FeatureCollection',
  features: PARCELS.features.map((feature) => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map((ring) => [...ring].reverse()),
    },
  })),
}

export function buildProjection(width: number, height: number): PlatProjection {
  const safeWidth = Math.max(width, 1)
  const safeHeight = Math.max(height, 1)

  const projection: GeoProjection = geoMercator().fitExtent(
    [
      [PADDING, PADDING],
      [Math.max(safeWidth - PADDING, PADDING + 1), Math.max(safeHeight - PADDING, PADDING + 1)],
    ],
    D3_PARCELS
  )

  const path = geoPath(projection)

  const parcels: ParcelPath[] = []
  for (const feature of D3_PARCELS.features) {
    const d = path(feature)
    if (!d) continue
    const [cx, cy] = path.centroid(feature)
    parcels.push({
      pin: normalizePin(feature.properties.pin),
      d,
      centroid: [cx ?? 0, cy ?? 0],
      area: path.area(feature),
      commonArea: feature.properties.commonArea ?? null,
    })
  }

  const streets: StreetPath[] = []
  STREETS.features.forEach((feature, index) => {
    const d = path(feature)
    if (!d) return
    streets.push({
      id: `${feature.properties.name}-${index}`,
      name: feature.properties.name,
      classification: feature.properties.classification,
      d,
      length: path.measure(feature),
    })
  })

  return {
    width: safeWidth,
    height: safeHeight,
    project: (point) => {
      const projected = projection(point)
      return projected ? [projected[0], projected[1]] : null
    },
    invert: (screen) => {
      const inverted = projection.invert?.(screen)
      return inverted ? [inverted[0], inverted[1]] : null
    },
    parcels,
    streets,
    parcelByPin: new Map(parcels.map((parcel) => [parcel.pin, parcel])),
  }
}

/**
 * Zoom at which lot numbers become legible.
 *
 * Below this the labels overlap each other and read as noise, so nothing is
 * drawn rather than something illegible.
 */
export const LABEL_ZOOM_THRESHOLD = 1.9

/** A lot smaller than this on screen cannot hold its own number. */
export const LABEL_MIN_AREA = 900

export function shouldLabel(parcel: ParcelPath, zoom: number): boolean {
  if (zoom < LABEL_ZOOM_THRESHOLD) return false
  return parcel.area * zoom * zoom >= LABEL_MIN_AREA
}

/** A street name is only drawn where the segment is long enough to hold it. */
export function shouldLabelStreet(street: StreetPath, zoom: number): boolean {
  return street.length * zoom >= street.name.length * 9
}
