import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'

import type { ParcelProperties } from '@/lib/geo'

import { PARCELS, platPins } from '@/lib/geo'

import { buildProjection } from './projection'

/*
  d3-geo reads a clockwise exterior ring as the complement: everything on the
  globe except that lot. On screen that is a solid block over the whole plat,
  and because such a shape has world-sized bounds it also drags fitExtent out
  and squashes every honest lot into a dot.

  The stored geometry follows RFC 7946 and projection.ts reverses it. This
  checks the reversal handles both shapes, because it did not: MultiPolygon
  coordinates are an array of polygons rather than an array of rings, so the
  Polygon path reversed the order of a lot's rings instead of its points. The
  40-lot fixture had no MultiPolygons and the harvested layer has 36.
*/

const SQUARE: [number, number][] = [
  [-81.1, 32.05],
  [-81.1, 32.051],
  [-81.099, 32.051],
  [-81.099, 32.05],
  [-81.1, 32.05],
]

/** Counterclockwise, as stored. */
function ccw(offset: number): [number, number][] {
  return SQUARE.map(([x, y]) => [x + offset, y] as [number, number])
}

function collection(
  features: FeatureCollection<Polygon | MultiPolygon, ParcelProperties>['features']
): FeatureCollection<Polygon | MultiPolygon, ParcelProperties> {
  return { type: 'FeatureCollection', features }
}

describe('winding order', () => {
  it('keeps a MultiPolygon lot the size of a lot', () => {
    const projection = buildProjection(
      400,
      400,
      collection([
        {
          type: 'Feature',
          properties: { pin: '20004 03001' },
          geometry: { type: 'MultiPolygon', coordinates: [[ccw(0)], [ccw(0.002)]] },
        },
        {
          type: 'Feature',
          properties: { pin: '20004 03002' },
          geometry: { type: 'Polygon', coordinates: [ccw(0.004)] },
        },
      ])
    )

    for (const parcel of projection.parcels) {
      const [minX, minY, maxX, maxY] = parcel.bounds
      // A complement fills the canvas and then some. A lot does not.
      expect(maxX - minX, parcel.pin).toBeLessThan(400)
      expect(maxY - minY, parcel.pin).toBeLessThan(400)
      expect(parcel.area, parcel.pin).toBeGreaterThan(0)
    }
  })

  it('does not let one bad lot drag the whole plat out of scale', () => {
    /*
      The failure was not only that the broken lot drew wrong. fitExtent frames
      every feature, so a world-sized one shrank all 16,656 others to a dot.
    */
    const withMulti = buildProjection(
      400,
      400,
      collection([
        {
          type: 'Feature',
          properties: { pin: 'multi' },
          geometry: { type: 'MultiPolygon', coordinates: [[ccw(0)]] },
        },
      ])
    )
    const withPlain = buildProjection(
      400,
      400,
      collection([
        {
          type: 'Feature',
          properties: { pin: 'plain' },
          geometry: { type: 'Polygon', coordinates: [ccw(0)] },
        },
      ])
    )

    // The same square either way, so it must frame to the same size.
    expect(withMulti.parcels[0]?.area).toBeCloseTo(withPlain.parcels[0]?.area ?? 0, 0)
  })
})

describe('merging the harvest with the committed fixture', () => {
  it('keeps every association lot drawable', () => {
    /*
      Every association lot is inside the harvest now that coverage is whole
      neighborhoods, but coverage is a list that can be shortened. When it was a
      rectangle, 29 of the association's own 40 platted lots sat outside it and
      replacing the fixture rather than merging dropped them off the drawing,
      which is the worst thing here to lose.
    */
    const harvestOnly = collection([
      {
        type: 'Feature',
        properties: { pin: '20003 15001' },
        geometry: { type: 'Polygon', coordinates: [ccw(0.01)] },
      },
    ])

    const projection = buildProjection(400, 400, harvestOnly)

    for (const pin of platPins()) {
      expect(projection.parcelByPin.has(pin), pin).toBe(true)
    }
    // Both sets are present, not one or the other.
    expect(projection.parcels.length).toBe(PARCELS.features.length + 1)
    expect(projection.parcelByPin.has('20003 15001')).toBe(true)
  })

  it('prefers the harvested geometry where both have a lot', () => {
    const existing = platPins()[0] ?? ''
    const shared = collection([
      {
        type: 'Feature',
        properties: { pin: existing },
        geometry: { type: 'Polygon', coordinates: [ccw(0.05)] },
      },
    ])

    const projection = buildProjection(400, 400, shared)
    // One entry for that PIN, not two, and the count did not grow.
    expect(projection.parcels.filter((p) => p.pin === existing)).toHaveLength(1)
    expect(projection.parcels.length).toBe(PARCELS.features.length)
  })
})
