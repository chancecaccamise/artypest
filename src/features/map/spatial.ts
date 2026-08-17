import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import distance from '@turf/distance'
import { point as turfPoint } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'

import { PARCELS, centroidForPin, parcelForPin, type ParcelFeature } from '@/lib/geo'
import type { Entity, LocationIndex } from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { readString } from '@/lib/format'
import { isCurrent, relationKey, type ResolvedGraph } from '@/lib/insights'
import { normalizePin } from '@/lib/parcels/pin'

/*
  Spatial queries. See docs/MAP-SPEC.md section 6.

  Renderer independent: Turf against the stored geometry, in geographic
  coordinates. Nothing here knows about screen space, which is what lets the
  same functions serve the plat now and a Mapbox layer later.

  Radius is in feet because covenants are written in feet.
*/

const FEET_PER_KILOMETRE = 3280.84

/**
 * Parcels whose boundaries touch or overlap the subject.
 *
 * `booleanIntersects` counts a shared edge, which is what "adjacent" means on
 * a plat: two lots that share a side lot line. Lots that merely face each
 * other across a street are not adjacent, and a board sending covenant notices
 * cares about that distinction.
 */
export function adjacentPins(pin: string): string[] {
  const subject = parcelForPin(pin)
  if (!subject) return []

  const key = normalizePin(pin)
  const found: string[] = []

  for (const candidate of PARCELS.features) {
    const candidatePin = normalizePin(candidate.properties.pin)
    if (candidatePin === key) continue
    if (booleanIntersects(subject, candidate)) found.push(candidatePin)
  }

  return found.sort((a, b) => a.localeCompare(b))
}

/** Parcels whose centroid is within `feet` of the subject's centroid. */
export function pinsWithinRadius(pin: string, feet: number): string[] {
  const origin = centroidForPin(pin)
  if (!origin) return []

  const key = normalizePin(pin)
  const from = turfPoint(origin)
  const found: { pin: string; feet: number }[] = []

  for (const candidate of PARCELS.features) {
    const candidatePin = normalizePin(candidate.properties.pin)
    if (candidatePin === key) continue

    const centre = centroidForPin(candidatePin)
    if (!centre) continue

    const away = distance(from, turfPoint(centre), { units: 'kilometers' }) * FEET_PER_KILOMETRE
    if (away <= feet) found.push({ pin: candidatePin, feet: away })
  }

  // Nearest first, which is the order a notification list is checked in.
  return found.sort((a, b) => a.feet - b.feet).map((row) => row.pin)
}

/** Parcels whose centroid falls inside a drawn or selected polygon. */
export function pinsWithinShape(shape: Feature<Polygon> | Polygon): string[] {
  const polygon = 'type' in shape && shape.type === 'Polygon' ? { type: 'Feature' as const, properties: {}, geometry: shape } : shape

  const found: string[] = []
  for (const candidate of PARCELS.features) {
    const centre = centroidForPin(candidate.properties.pin)
    if (!centre) continue
    if (booleanPointInPolygon(turfPoint(centre), polygon)) {
      found.push(normalizePin(candidate.properties.pin))
    }
  }
  return found.sort((a, b) => a.localeCompare(b))
}

/** Distance in feet between two lots, centroid to centroid. */
export function feetBetween(pinA: string, pinB: string): number | null {
  const a = centroidForPin(pinA)
  const b = centroidForPin(pinB)
  if (!a || !b) return null
  return distance(turfPoint(a), turfPoint(b), { units: 'kilometers' }) * FEET_PER_KILOMETRE
}

export function feetFromPoint(pin: string, target: Point): number | null {
  const origin = centroidForPin(pin)
  if (!origin) return null
  return distance(turfPoint(origin), turfPoint(target), { units: 'kilometers' }) * FEET_PER_KILOMETRE
}

export type { ParcelFeature }

/* ------------------------------------------------------ notify neighbours -- */

export interface NotifyRecipient {
  ownerId: string
  ownerName: string
  ownerType: 'person' | 'business'
  mailingAddress: string | null
  email: string | null
  phone: string | null
  /** Lots this owner holds among the notified parcels. */
  lots: { pin: string; propertyId: string; propertyName: string }[]
  /** True when there is no way to reach this owner. Called out, not dropped. */
  unreachable: boolean
}

export interface NotifyList {
  subjectPin: string
  /** Adjacent parcels, including any with no owner on file. */
  parcels: { pin: string; propertyId: string | null; propertyName: string | null }[]
  recipients: NotifyRecipient[]
  /** Adjacent lots with nobody to notify. The gap a board needs to see. */
  parcelsWithNoOwner: { pin: string; propertyName: string | null }[]
}

export interface NotifyInput {
  subjectPin: string
  graph: ResolvedGraph
  locations: LocationIndex
  today?: Date
  /** When set, uses a radius instead of shared boundaries. */
  radiusFeet?: number
}

/**
 * The mailing list an architectural review notification needs.
 *
 * De-duplicated by owner, because one person owning three adjacent lots gets
 * one letter, not three. Owners with no address and no contact details are
 * listed and flagged rather than quietly dropped, since a notice that was
 * never sent is the thing that voids the decision later.
 */
export function buildNotifyList({
  subjectPin,
  graph,
  locations,
  today,
  radiusFeet,
}: NotifyInput): NotifyList {
  const pins = radiusFeet ? pinsWithinRadius(subjectPin, radiusFeet) : adjacentPins(subjectPin)

  const parcels: NotifyList['parcels'] = []
  const parcelsWithNoOwner: NotifyList['parcelsWithNoOwner'] = []
  const byOwner = new Map<string, NotifyRecipient>()

  for (const pin of pins) {
    const property = locations.propertyByPin.get(pin)
    parcels.push({
      pin,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
    })

    if (!property) {
      parcelsWithNoOwner.push({ pin, propertyName: null })
      continue
    }

    const owners = currentOwners(property, graph, today)
    if (owners.length === 0) {
      parcelsWithNoOwner.push({ pin, propertyName: property.name })
      continue
    }

    for (const owner of owners) {
      const existing = byOwner.get(owner.id)
      const lot = { pin, propertyId: property.id, propertyName: property.name }

      if (existing) {
        existing.lots.push(lot)
        continue
      }

      const mailingAddress = readString(owner.data.mailingAddress) || null
      const email = readString(owner.data.email) || null
      const phone = readString(owner.data.phone) || null

      byOwner.set(owner.id, {
        ownerId: owner.id,
        ownerName: owner.name,
        ownerType: owner.type === 'business' ? 'business' : 'person',
        mailingAddress,
        email,
        phone,
        lots: [lot],
        unreachable: mailingAddress === null && email === null && phone === null,
      })
    }
  }

  const recipients = [...byOwner.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName))

  return { subjectPin, parcels, recipients, parcelsWithNoOwner }
}

function currentOwners(property: Entity, graph: ResolvedGraph, today?: Date): Entity[] {
  const owners: Entity[] = []

  for (const relation of graph.relationsFor.get(property.id) ?? []) {
    if (relationKey(relation, graph) !== 'owns') continue
    if (relation.toEntityId !== property.id) continue
    if (!isCurrent(relation, today)) continue

    const owner = graph.byId.get(relation.fromEntityId)
    if (!owner) continue
    if (owner.deletedAt !== null || owner.archivedAt !== null) continue
    owners.push(owner)
  }

  return owners
}

/** A mailing list as text, for pasting into a letter or a mail merge. */
export function notifyListAsText(list: NotifyList): string {
  const lines: string[] = []

  lines.push(`Adjacent owner notification for parcel ${list.subjectPin}`)
  lines.push(`${list.recipients.length} owners across ${list.parcels.length} adjacent lots`)
  lines.push('')

  for (const recipient of list.recipients) {
    lines.push(recipient.ownerName)
    lines.push(recipient.mailingAddress ?? 'No mailing address on file')
    lines.push(`  Lots: ${recipient.lots.map((lot) => lot.propertyName).join(', ')}`)
    if (recipient.unreachable) lines.push('  No contact details on file')
    lines.push('')
  }

  if (list.parcelsWithNoOwner.length > 0) {
    lines.push(`${list.parcelsWithNoOwner.length} adjacent lots have no current owner on file:`)
    for (const parcel of list.parcelsWithNoOwner) {
      lines.push(`  ${parcel.propertyName ?? parcel.pin}`)
    }
  }

  return lines.join('\n')
}
