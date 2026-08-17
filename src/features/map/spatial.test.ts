import { describe, expect, it } from 'vitest'

import {
  adjacentPins,
  buildNotifyList,
  feetBetween,
  notifyListAsText,
  pinsWithinRadius,
  pinsWithinShape,
} from './spatial'
import { PARCELS, centroidForPin } from '@/lib/geo'
import { buildDemoData } from '@/lib/data/fixtures'
import { resolveAllLocations } from '@/lib/locations/resolve'
import { geocodeSync } from '@/lib/geocoding'
import { resolveGraph } from '@/lib/insights'
import { normalizePin } from '@/lib/parcels/pin'

const TODAY = new Date('2026-08-01T00:00:00.000Z')

const PINS = PARCELS.features.map((feature) => normalizePin(feature.properties.pin))

function demoContext() {
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
  return { graph, locations }
}

describe('adjacentPins', () => {
  it('finds neighbours for a lot in a facing row', () => {
    // Lots in a row share a side lot line, so every interior lot has two.
    const interior = PINS[3]
    expect(interior).toBeDefined()
    if (!interior) return

    const neighbours = adjacentPins(interior)
    expect(neighbours.length).toBeGreaterThanOrEqual(2)
    expect(neighbours).not.toContain(interior)
  })

  it('is symmetric: if A touches B then B touches A', () => {
    for (const pin of PINS.slice(0, 12)) {
      for (const neighbour of adjacentPins(pin)) {
        expect(adjacentPins(neighbour)).toContain(pin)
      }
    }
  })

  it('returns nothing for a PIN with no geometry rather than throwing', () => {
    expect(adjacentPins('29999 99999')).toEqual([])
    expect(adjacentPins('')).toEqual([])
  })

  it('never reports a lot as its own neighbour', () => {
    for (const pin of PINS) {
      expect(adjacentPins(pin)).not.toContain(pin)
    }
  })
})

describe('pinsWithinRadius', () => {
  const subject = PINS[5] ?? ''

  it('returns lots ordered nearest first', () => {
    const found = pinsWithinRadius(subject, 600)
    const distances = found.map((pin) => feetBetween(subject, pin) ?? 0)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  it('grows monotonically with the radius', () => {
    const near = pinsWithinRadius(subject, 200)
    const far = pinsWithinRadius(subject, 900)
    expect(far.length).toBeGreaterThanOrEqual(near.length)
    for (const pin of near) expect(far).toContain(pin)
  })

  it('excludes the subject and respects the bound', () => {
    const found = pinsWithinRadius(subject, 400)
    expect(found).not.toContain(subject)
    for (const pin of found) {
      expect(feetBetween(subject, pin) ?? Infinity).toBeLessThanOrEqual(400)
    }
  })

  it('measures in feet, so a neighbouring lot is a plausible distance away', () => {
    const neighbours = adjacentPins(subject)
    const first = neighbours[0]
    expect(first).toBeDefined()
    if (!first) return

    const feet = feetBetween(subject, first) ?? 0
    // Lots are 60 to 100 feet of frontage, so a neighbour's centroid is well
    // under a few hundred feet away. This is what catches a units mistake.
    expect(feet).toBeGreaterThan(10)
    expect(feet).toBeLessThan(400)
  })
})

describe('pinsWithinShape', () => {
  it('selects the lots whose centroid falls inside a drawn box', () => {
    const centre = centroidForPin(PINS[0] ?? '')
    expect(centre).not.toBeNull()
    if (!centre) return

    const [lng, lat] = centre
    const box = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [lng - 0.0004, lat - 0.0004],
          [lng + 0.0004, lat - 0.0004],
          [lng + 0.0004, lat + 0.0004],
          [lng - 0.0004, lat + 0.0004],
          [lng - 0.0004, lat - 0.0004],
        ],
      ],
    }

    const found = pinsWithinShape(box)
    expect(found).toContain(PINS[0])
    expect(found.length).toBeLessThan(PINS.length)
  })

  it('selects everything when the shape covers the whole plat', () => {
    const box = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-81.2, 31.9],
          [-81.0, 31.9],
          [-81.0, 32.2],
          [-81.2, 32.2],
          [-81.2, 31.9],
        ],
      ],
    }
    expect(pinsWithinShape(box)).toHaveLength(PINS.length)
  })
})

describe('buildNotifyList', () => {
  const { graph, locations } = demoContext()
  const subject = PINS[4] ?? ''

  it('produces one recipient per owner, not one per lot', () => {
    const list = buildNotifyList({ subjectPin: subject, graph, locations, today: TODAY })

    const ids = list.recipients.map((recipient) => recipient.ownerId)
    expect(new Set(ids).size).toBe(ids.length)

    // Every lot an owner holds is listed under that one recipient.
    for (const recipient of list.recipients) {
      expect(recipient.lots.length).toBeGreaterThan(0)
    }
  })

  it('lists adjacent lots that have nobody to notify rather than dropping them', () => {
    const list = buildNotifyList({ subjectPin: subject, graph, locations, today: TODAY })
    const named = new Set(list.parcels.map((parcel) => parcel.pin))

    for (const gap of list.parcelsWithNoOwner) {
      expect(named.has(gap.pin)).toBe(true)
    }

    const covered =
      list.recipients.flatMap((recipient) => recipient.lots.map((lot) => lot.pin)).length +
      list.parcelsWithNoOwner.length
    expect(covered).toBeGreaterThanOrEqual(list.parcels.length)
  })

  it('flags an owner with no address and no contact details', () => {
    const list = buildNotifyList({ subjectPin: subject, graph, locations, today: TODAY })
    for (const recipient of list.recipients) {
      const reachable =
        recipient.mailingAddress !== null || recipient.email !== null || recipient.phone !== null
      expect(recipient.unreachable).toBe(!reachable)
    }
  })

  it('can work from a radius instead of shared boundaries', () => {
    const adjacent = buildNotifyList({ subjectPin: subject, graph, locations, today: TODAY })
    const radius = buildNotifyList({
      subjectPin: subject,
      graph,
      locations,
      today: TODAY,
      radiusFeet: 500,
    })

    expect(radius.parcels.length).toBeGreaterThanOrEqual(adjacent.parcels.length)
  })

  it('renders a mailing list that names the gaps', () => {
    const list = buildNotifyList({ subjectPin: subject, graph, locations, today: TODAY })
    const text = notifyListAsText(list)

    expect(text).toContain(subject)
    expect(text).toContain('adjacent lots')
    for (const recipient of list.recipients) {
      expect(text).toContain(recipient.ownerName)
    }
  })

  it('returns an empty list for a lot with no geometry', () => {
    const list = buildNotifyList({ subjectPin: '29999 99999', graph, locations, today: TODAY })
    expect(list.parcels).toEqual([])
    expect(list.recipients).toEqual([])
  })
})
