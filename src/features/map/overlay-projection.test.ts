import { describe, expect, it } from 'vitest'

import type { OverlayCollection } from '@/lib/overlays'

import { projectOverlay, shouldLabelOverlay } from './projection'

/*
  Projecting a district boundary, and deciding where its name goes.

  The label is the part with a real argument behind it. A voting precinct is far
  larger than the plat's opening view, so its centroid is usually off screen,
  and a boundary a reader cannot identify is decoration.
*/

/** Identity projection: drawing space and geographic space are the same here. */
const identity = (point: [number, number]): [number, number] => [point[0], point[1]]

const collection = (
  features: { name: string; detail: string; ring: [number, number][] }[]
): OverlayCollection => ({
  type: 'FeatureCollection',
  features: features.map((feature) => ({
    type: 'Feature' as const,
    properties: { name: feature.name, detail: feature.detail },
    geometry: { type: 'Polygon' as const, coordinates: [feature.ring] },
  })),
})

describe('projecting a boundary', () => {
  it('draws a closed path and measures where it sits', () => {
    const [area] = projectOverlay(
      collection([
        { name: 'District 3', detail: 'Linda Wilder-Bryan', ring: [[0, 0], [100, 0], [100, 50], [0, 50]] },
      ]),
      identity
    )

    expect(area?.name).toBe('District 3')
    expect(area?.detail).toBe('Linda Wilder-Bryan')
    expect(area?.d.startsWith('M ')).toBe(true)
    expect(area?.d.endsWith('Z')).toBe(true)
    expect(area?.bounds).toEqual([0, 0, 100, 50])
    expect(area?.area).toBe(5000)
  })

  it('puts the label at the mean of the vertices, not the centre of the box', () => {
    /*
      An L-shaped district has a bounding box centre that sits outside it, and a
      label floating in the neighbouring district is worse than no label.
    */
    const [area] = projectOverlay(
      collection([
        {
          name: 'L',
          detail: '',
          ring: [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]],
        },
      ]),
      identity
    )

    const boxCentre = [50, 50]
    expect(area?.centroid[0]).toBeLessThan(boxCentre[0] ?? 0)
    expect(area?.centroid[1]).toBeLessThan(boxCentre[1] ?? 0)
  })

  it('handles a district published as several separate pieces', () => {
    const multi: OverlayCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Split', detail: '' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [[[0, 0], [10, 0], [10, 10], [0, 10]]],
              [[[90, 90], [100, 90], [100, 100], [90, 100]]],
            ],
          },
        },
      ],
    }

    const [area] = projectOverlay(multi, identity)
    expect(area?.bounds).toEqual([0, 0, 100, 100])
    // Two subpaths, so the pieces are not joined by a line across the map.
    expect(area?.d.match(/M /g)).toHaveLength(2)
  })

  it('skips a feature with no geometry rather than drawing an empty path', () => {
    const missing: OverlayCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Nowhere', detail: '' }, geometry: null }],
    }
    expect(projectOverlay(missing, identity)).toEqual([])
  })

  it('skips a feature the projection cannot place', () => {
    const offGlobe = collection([{ name: 'Off', detail: '', ring: [[0, 0], [1, 0], [1, 1]] }])
    expect(projectOverlay(offGlobe, () => null)).toEqual([])
  })
})

describe('deciding whether a district is big enough to label', () => {
  const areaOf = (side: number) =>
    projectOverlay(
      collection([{ name: 'D', detail: '', ring: [[0, 0], [side, 0], [side, side], [0, side]] }]),
      identity
    )[0]

  it('labels a district that fills a good part of the view', () => {
    const big = areaOf(200)
    expect(big && shouldLabelOverlay(big, 1)).toBe(true)
  })

  it('does not label a sliver', () => {
    const sliver = areaOf(10)
    expect(sliver && shouldLabelOverlay(sliver, 1)).toBe(false)
  })

  it('labels that sliver once the reader has zoomed into it', () => {
    const sliver = areaOf(10)
    expect(sliver && shouldLabelOverlay(sliver, 20)).toBe(true)
  })
})
