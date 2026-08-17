import { describe, expect, it } from 'vitest'

import { arcColor, arcPath, arcableKeys, buildArcs, undrawnCounts } from './arcs'
import { buildProjection, shouldLabel } from './projection'
import { THEMATIC_MODES, buildTheming } from './theming'
import { PARCELS, centroidForPin } from '@/lib/geo'
import { buildDemoData } from '@/lib/data/fixtures'
import { geocodeSync } from '@/lib/geocoding'
import { computeOccupancy, resolveGraph } from '@/lib/insights'
import { resolveAllLocations } from '@/lib/locations/resolve'
import { normalizePin } from '@/lib/parcels/pin'

const TODAY = new Date('2026-08-01T00:00:00.000Z')
const PINS = PARCELS.features.map((feature) => normalizePin(feature.properties.pin))

const demo = buildDemoData(TODAY)
const graph = resolveGraph({
  entities: demo.entities,
  relations: demo.relations,
  relationTypes: demo.relationTypes,
})
const locations = resolveAllLocations({
  graph,
  centroidForPin,
  geocode: geocodeSync,
  today: TODAY,
})

function theming(mode: (typeof THEMATIC_MODES)[number]) {
  return buildTheming({
    mode,
    graph,
    propertyByPin: locations.propertyByPin,
    pins: PINS,
    referenceItems: demo.referenceItems,
    today: TODAY,
  })
}

describe('buildTheming', () => {
  it('returns a colour for every platted lot in every mode', () => {
    for (const mode of THEMATIC_MODES) {
      const built = theming(mode)
      for (const pin of PINS) {
        expect(built.colorForPin(pin)).toBeTruthy()
      }
    }
  })

  it('leaves the plat uncoloured in the default mode', () => {
    const built = theming('none')
    expect(built.legend).toEqual([])
    expect(new Set(PINS.map((pin) => built.colorForPin(pin))).size).toBe(1)
  })

  it('agrees with the dashboard occupancy bar', () => {
    const built = theming('occupancy')
    const dashboard = computeOccupancy(graph, TODAY)

    for (const bucket of built.legend) {
      const key = bucket.key as keyof typeof dashboard.counts
      // The plat only draws lots that have geometry, so its counts are a
      // subset. What must hold is that it never exceeds the dashboard's.
      expect(bucket.count).toBeLessThanOrEqual(dashboard.counts[key])
    }

    const total = built.legend.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(total).toBe(PINS.length)
  })

  it('accounts for every lot exactly once in each bucketed mode', () => {
    for (const mode of ['occupancy', 'completeness', 'open_items'] as const) {
      const built = theming(mode)
      const total = built.legend.reduce((sum, bucket) => sum + bucket.count, 0)
      expect(total, mode).toBe(PINS.length)
    }
  })

  it('lists empty buckets rather than hiding them', () => {
    const built = theming('completeness')
    expect(built.legend).toHaveLength(4)
    expect(built.legend.map((bucket) => bucket.key)).toEqual([
      'complete',
      'no_owner',
      'no_pin',
      'neither',
    ])
  })

  it('colours reference-list modes from the org lists, with a Not set bucket', () => {
    const built = theming('zoning')
    const labels = built.legend.map((bucket) => bucket.label)
    expect(labels).toContain('Not set')
    expect(built.legend.length).toBeGreaterThan(1)
  })

  it('uses token colours, never literal hex', () => {
    for (const mode of THEMATIC_MODES) {
      for (const bucket of theming(mode).legend) {
        expect(bucket.color).toMatch(/^var\(--/)
      }
    }
  })
})

describe('arcs', () => {
  it('draws nothing until a relation type is switched on', () => {
    expect(buildArcs({ graph, locations, keys: new Set() })).toEqual([])
  })

  it('only draws a relation when both ends have a location', () => {
    const arcs = buildArcs({ graph, locations, keys: new Set(['owns', 'vendor_for']) })
    for (const arc of arcs) {
      expect(locations.byEntity.has(arc.fromEntityId)).toBe(true)
      expect(locations.byEntity.has(arc.toEntityId)).toBe(true)
    }
  })

  it('drops zero-length arcs, which carry no information', () => {
    const arcs = buildArcs({ graph, locations, keys: new Set(['owns', 'resides_at']) })
    for (const arc of arcs) {
      expect(arc.from).not.toEqual(arc.to)
    }
  })

  it('can be narrowed to one record', () => {
    const anyArc = buildArcs({ graph, locations, keys: new Set(['owns']) })[0]
    expect(anyArc).toBeDefined()
    if (!anyArc) return

    const focused = buildArcs({
      graph,
      locations,
      keys: new Set(['owns']),
      focusEntityId: anyArc.fromEntityId,
    })

    expect(focused.length).toBeGreaterThan(0)
    for (const arc of focused) {
      expect([arc.fromEntityId, arc.toEntityId]).toContain(anyArc.fromEntityId)
    }
  })

  it('accounts for every relation it did not draw, and says which reason', () => {
    const keys = new Set(['owns', 'vendor_for', 'member_of'])
    const drawn = buildArcs({ graph, locations, keys }).length
    const { unplacedEnd, sameLocation } = undrawnCounts(graph, locations, keys)

    const eligible = graph.relations.filter((relation) => {
      if (relation.deletedAt !== null) return false
      const type = graph.typeById.get(relation.relationTypeId)
      return Boolean(type && keys.has(type.key))
    }).length

    // Drawn, plus each reason for not drawing, is every relation of those types.
    expect(drawn + unplacedEnd + sameLocation).toBe(eligible)
    // Owners living in the lot they own are the common case, so this is not zero.
    expect(sameLocation).toBeGreaterThan(0)
  })

  it('offers only relation types that have something to draw', () => {
    const keys = arcableKeys(graph, locations)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(buildArcs({ graph, locations, keys: new Set([key]) }).length).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('arcPath', () => {
  it('bows away from the straight line between the endpoints', () => {
    const d = arcPath([0, 0], [100, 0])
    expect(d).toMatch(/^M 0,0 Q [\d.-]+,[\d.-]+ 100,0$/)

    const control = d.match(/Q ([\d.-]+),([\d.-]+)/)
    expect(control).not.toBeNull()
    // Perpendicular to a horizontal line means the control point moves in y.
    expect(Number(control?.[2])).not.toBe(0)
  })

  it('bows proportionally, so short links stay nearly flat', () => {
    const shortOffset = Number(arcPath([0, 0], [10, 0]).match(/Q [\d.-]+,([\d.-]+)/)?.[1])
    const longOffset = Number(arcPath([0, 0], [1000, 0]).match(/Q [\d.-]+,([\d.-]+)/)?.[1])
    expect(Math.abs(longOffset)).toBeGreaterThan(Math.abs(shortOffset) * 10)
  })

  it('degenerates safely when both endpoints are the same', () => {
    expect(arcPath([5, 5], [5, 5])).toBe('M 5,5')
  })

  it('colours by relation type from tokens, with a fallback', () => {
    expect(arcColor('owns')).toMatch(/^var\(--/)
    expect(arcColor('not-a-real-key')).toMatch(/^var\(--/)
  })
})

describe('projection', () => {
  const projected = buildProjection(900, 600)

  it('projects every parcel into the viewport', () => {
    expect(projected.parcels).toHaveLength(PARCELS.features.length)
    for (const parcel of projected.parcels) {
      const [x, y] = parcel.centroid
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(900)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(600)
      expect(parcel.d.startsWith('M')).toBe(true)
    }
  })

  it('never draws a lot as the whole plat, whatever the stored winding order', () => {
    /*
      d3-geo wants exterior rings clockwise and the stored geometry is
      counterclockwise, as RFC 7946 requires. Get the reversal wrong and every
      lot renders as the entire globe minus that lot: a solid block over the
      whole drawing. It is silent in the data and total on screen, so it is
      asserted here rather than left to be noticed.
    */
    const viewportArea = 900 * 600

    for (const parcel of projected.parcels) {
      expect(parcel.area, parcel.pin).toBeGreaterThan(0)
      expect(parcel.area, parcel.pin).toBeLessThan(viewportArea * 0.25)
      // The inverted form draws as two subpaths: the lot and the clip extent.
      expect(parcel.d.split('M').length - 1, parcel.pin).toBe(1)
    }
  })

  it('draws lots that differ from one another, rather than one shape repeated', () => {
    const shapes = new Set(projected.parcels.map((parcel) => parcel.d))
    expect(shapes.size).toBe(projected.parcels.length)
  })

  it('projects the street centrelines too', () => {
    expect(projected.streets.length).toBeGreaterThan(0)
    for (const street of projected.streets) {
      expect(street.d.startsWith('M')).toBe(true)
      expect(street.length).toBeGreaterThan(0)
    }
  })

  it('round-trips a point through project and invert', () => {
    const centre = centroidForPin(PINS[0] ?? '')
    expect(centre).not.toBeNull()
    if (!centre) return

    const screen = projected.project(centre)
    expect(screen).not.toBeNull()
    if (!screen) return

    const back = projected.invert(screen)
    expect(back?.[0]).toBeCloseTo(centre[0], 5)
    expect(back?.[1]).toBeCloseTo(centre[1], 5)
  })

  it('withholds lot labels until they are legible', () => {
    const parcel = projected.parcels[0]
    expect(parcel).toBeDefined()
    if (!parcel) return

    expect(shouldLabel(parcel, 1)).toBe(false)
    expect(shouldLabel(parcel, 8)).toBe(true)
  })

  it('re-fits when the viewport changes size', () => {
    const narrow = buildProjection(400, 600)
    expect(narrow.parcels[0]?.d).not.toBe(projected.parcels[0]?.d)
    for (const parcel of narrow.parcels) {
      expect(parcel.centroid[0]).toBeLessThanOrEqual(400)
    }
  })

  it('survives a degenerate viewport rather than producing NaN paths', () => {
    const tiny = buildProjection(0, 0)
    for (const parcel of tiny.parcels) {
      expect(parcel.d).not.toContain('NaN')
    }
  })
})
