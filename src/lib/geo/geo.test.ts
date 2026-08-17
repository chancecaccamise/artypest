import area from '@turf/area'
import { featureCollection } from '@turf/helpers'
import intersect from '@turf/intersect'
import { describe, expect, it } from 'vitest'

import { PARCELS, PLAT_BOUNDS, STREETS, centroidForPin, isWithinPlat, parcelForPin, platPins } from '.'
import { isValidPin, normalizePin } from '@/lib/parcels/pin'
import RAW_PARCELS from '@/lib/parcels/fixtures/chatham-sample.json'

/*
  The plat geometry itself.

  Winding order gets its own test because getting it wrong is silent in the
  data and catastrophic on screen: d3-geo treats geometry as spherical, so a
  clockwise exterior ring renders as the entire rest of the world rather than
  as a lot. Half the generated parcels were wound that way at first, and one of
  them covered the whole drawing.
*/

/** Shoelace. Positive is counterclockwise with longitude east, latitude north. */
function signedArea(ring: number[][]): number {
  let total = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]
    const next = ring[index + 1]
    if (!current || !next) continue
    total += (current[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (current[1] ?? 0)
  }
  return total / 2
}

/** Whether two segments properly cross, ignoring shared endpoints. */
function crosses(
  [ax, ay]: number[],
  [bx, by]: number[],
  [cx, cy]: number[],
  [dx, dy]: number[]
): boolean {
  const orientation = (px = 0, py = 0, qx = 0, qy = 0, rx = 0, ry = 0) =>
    Math.sign((qy - py) * (rx - qx) - (qx - px) * (ry - qy))

  const o1 = orientation(ax, ay, bx, by, cx, cy)
  const o2 = orientation(ax, ay, bx, by, dx, dy)
  const o3 = orientation(cx, cy, dx, dy, ax, ay)
  const o4 = orientation(cx, cy, dx, dy, bx, by)

  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
}

function selfIntersects(ring: number[][]): boolean {
  const edges = ring.slice(0, -1)
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      // Adjacent edges share a corner, and the first and last close the ring.
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue
      const a = edges[i]
      const b = edges[(i + 1) % edges.length]
      const c = edges[j]
      const d = edges[(j + 1) % edges.length]
      if (!a || !b || !c || !d) continue
      if (crosses(a, b, c, d)) return true
    }
  }
  return false
}

describe('parcel geometry', () => {
  it('winds every exterior ring counterclockwise, as RFC 7946 requires', () => {
    for (const feature of PARCELS.features) {
      const ring = feature.geometry.coordinates[0]
      expect(ring, feature.properties.pin).toBeDefined()
      if (!ring) continue
      expect(signedArea(ring), `${feature.properties.pin} is wound clockwise`).toBeGreaterThan(0)
    }
  })

  it('closes every ring', () => {
    for (const feature of PARCELS.features) {
      const ring = feature.geometry.coordinates[0]
      if (!ring) continue
      expect(ring[0]).toEqual(ring[ring.length - 1])
    }
  })

  it('gives every lot at least four distinct corners', () => {
    for (const feature of PARCELS.features) {
      const ring = feature.geometry.coordinates[0] ?? []
      expect(ring.length, feature.properties.pin).toBeGreaterThanOrEqual(5)
    }
  })

  it('keeps every lot to a plausible size for a subdivision', () => {
    for (const feature of PARCELS.features) {
      const ring = feature.geometry.coordinates[0]
      if (!ring) continue
      // Degrees squared is not an area anyone reads, but the bound is what
      // catches a lot that has quietly become the size of the county.
      expect(Math.abs(signedArea(ring)), feature.properties.pin).toBeLessThan(1e-6)
    }
  })

  it('never lets a lot boundary cross itself', () => {
    /*
      d3-geo clips a self-intersecting ring against the sphere, so a bowtie
      does not draw as a bowtie: it draws as the entire rest of the world
      covering the plat. The cul-de-sac wedges had their rear corners listed
      out of order and did exactly that.
    */
    for (const feature of PARCELS.features) {
      const ring = feature.geometry.coordinates[0] ?? []
      expect(selfIntersects(ring), `${feature.properties.pin} crosses itself`).toBe(false)
    }
  })

  it('never overlaps one lot with another', () => {
    /*
      Two lots cannot occupy the same ground on a recorded plat. Sharing a
      boundary is normal and produces a sliver or zero-area intersection, so
      the threshold is a few square metres rather than zero.
    */
    const features = PARCELS.features
    for (let i = 0; i < features.length; i += 1) {
      for (let j = i + 1; j < features.length; j += 1) {
        const a = features[i]
        const b = features[j]
        if (!a || !b) continue

        const overlap = intersect(featureCollection([a, b]))
        if (!overlap) continue

        expect(
          area(overlap),
          `${a.properties.pin} overlaps ${b.properties.pin}`
        ).toBeLessThan(5)
      }
    }
  })

  it('carries a valid, unique PIN on every parcel', () => {
    const pins = PARCELS.features.map((feature) => feature.properties.pin)
    expect(new Set(pins).size).toBe(pins.length)
    for (const pin of pins) {
      expect(isValidPin(pin), pin).toBe(true)
    }
  })

  it('keys to the parcel fixture, which is what joins geometry to records', () => {
    const seeded = new Set(
      (RAW_PARCELS as { pin: string }[]).slice(0, 40).map((parcel) => normalizePin(parcel.pin))
    )
    for (const pin of platPins()) {
      expect(seeded.has(pin), pin).toBe(true)
    }
  })

  it('includes the two common areas as ordinary parcels', () => {
    const common = PARCELS.features.filter((feature) => feature.properties.commonArea)
    expect(common).toHaveLength(2)
    // They carry PINs like any other lot, so nothing downstream special-cases them.
    for (const feature of common) {
      expect(isValidPin(feature.properties.pin)).toBe(true)
    }
  })
})

describe('centroids and bounds', () => {
  it('puts every centroid inside the platted bounds', () => {
    for (const pin of platPins()) {
      const centre = centroidForPin(pin)
      expect(centre, pin).not.toBeNull()
      if (!centre) continue
      expect(isWithinPlat(centre), pin).toBe(true)
    }
  })

  it('returns null rather than throwing for an unknown PIN', () => {
    expect(centroidForPin('29999 99999')).toBeNull()
    expect(centroidForPin(null)).toBeNull()
    expect(parcelForPin(undefined)).toBeNull()
  })

  it('looks up on the normalised PIN, so casing and spacing do not matter', () => {
    const pin = PARCELS.features[0]?.properties.pin ?? ''
    expect(centroidForPin(pin.toLowerCase())).toEqual(centroidForPin(pin))
  })

  it('reports a point well outside the subdivision as off the plat', () => {
    // Downtown Savannah, a few miles north.
    expect(isWithinPlat([-81.0912, 32.0809])).toBe(false)
  })

  it('bounds a neighbourhood, not a county', () => {
    expect(PLAT_BOUNDS.east - PLAT_BOUNDS.west).toBeLessThan(0.02)
    expect(PLAT_BOUNDS.north - PLAT_BOUNDS.south).toBeLessThan(0.02)
    expect(PLAT_BOUNDS.east).toBeGreaterThan(PLAT_BOUNDS.west)
    expect(PLAT_BOUNDS.north).toBeGreaterThan(PLAT_BOUNDS.south)
  })
})

describe('street centrelines', () => {
  it('names every segment, since the plat has no basemap to name them', () => {
    expect(STREETS.features.length).toBeGreaterThan(0)
    for (const feature of STREETS.features) {
      expect(feature.properties.name).toBeTruthy()
      expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2)
    }
  })
})
