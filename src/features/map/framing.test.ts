import { describe, expect, it } from 'vitest'

import { frameTransform } from './projection'

/*
  Framing the plat on something.

  The plat draws every lot the county recorded, and the association tracks a few
  dozen of them. Opening on the county meant the association's records, and
  every connection between them, occupied about a sixtieth of the drawing: the
  arcs were rendered correctly and were shorter than their own stroke width.
*/

const VIEW = { width: 900, height: 600 }
const MIN_ZOOM = 0.5
const MAX_ZOOM = 250
const FILL = 0.78

const frame = (bounds: readonly [number, number, number, number]) =>
  frameTransform(bounds, VIEW.width, VIEW.height, FILL, MIN_ZOOM, MAX_ZOOM)

/** Where a point in drawing space lands on screen under a transform. */
const project = (
  { k, x, y }: { k: number; x: number; y: number },
  point: [number, number]
): [number, number] => [point[0] * k + x, point[1] * k + y]

describe('framing an area of the plat', () => {
  it('puts the centre of the area in the centre of the view', () => {
    const transform = frame([100, 100, 300, 200])
    const [screenX, screenY] = project(transform, [200, 150])

    expect(screenX).toBeCloseTo(VIEW.width / 2)
    expect(screenY).toBeCloseTo(VIEW.height / 2)
  })

  it('fills the requested fraction of the limiting dimension', () => {
    // Wide and short, so width is what limits the scale.
    const transform = frame([0, 0, 1000, 100])
    expect(1000 * transform.k).toBeCloseTo(VIEW.width * FILL)

    // Tall and narrow, so height limits it. Kept above the zoom floor: a
    // rectangle taller than the viewport can hold at MIN_ZOOM is clamped, and
    // that clamp is the subject of its own test below.
    const tall = frame([0, 0, 50, 500])
    expect(500 * tall.k).toBeCloseTo(VIEW.height * FILL)
  })

  it('keeps the whole area on screen', () => {
    const bounds = [40, 60, 340, 260] as const
    const transform = frame(bounds)

    const [left, top] = project(transform, [bounds[0], bounds[1]])
    const [right, bottom] = project(transform, [bounds[2], bounds[3]])

    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(VIEW.width)
    expect(bottom).toBeLessThanOrEqual(VIEW.height)
  })

  it('actually magnifies a small cluster inside a large drawing', () => {
    /*
      The regression this guards. `buildProjection` already fits the whole
      harvest to the viewport, so the county is roughly viewport-sized in
      drawing space and identity is "everything". The association's lots are a
      small rectangle inside that, and framing them has to be a real
      magnification rather than something close to identity.

      Measured from the real layer: the harvest spans 4.3 by 7.9 km and the
      association's lots 1.1 by 0.44 km, so they occupy about a sixtieth of it.
    */
    const associationLots = [430, 300, 480, 330] as const

    const association = frame(associationLots)

    expect(association.k).toBeGreaterThan(10)
    // Identity is the whole drawing, so this is how much closer the reader gets.
    expect(association.k).toBeLessThanOrEqual(MAX_ZOOM)
  })

  it('does not zoom past the plat\'s own ceiling for a single lot', () => {
    const transform = frame([500, 500, 502, 501])
    expect(transform.k).toBeLessThanOrEqual(MAX_ZOOM)
  })

  it('does not zoom below the floor for something enormous', () => {
    const transform = frame([0, 0, 10_000_000, 10_000_000])
    expect(transform.k).toBeGreaterThanOrEqual(MIN_ZOOM)
  })

  it('survives an area with no extent, such as one marker on its own', () => {
    const transform = frame([700, 400, 700, 400])

    expect(Number.isFinite(transform.k)).toBe(true)
    expect(Number.isFinite(transform.x)).toBe(true)
    expect(Number.isFinite(transform.y)).toBe(true)

    const [screenX, screenY] = project(transform, [700, 400])
    expect(screenX).toBeCloseTo(VIEW.width / 2)
    expect(screenY).toBeCloseTo(VIEW.height / 2)
  })
})
