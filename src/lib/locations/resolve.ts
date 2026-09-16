import type {
  Entity,
  EntityType,
  LocationIndex,
  LocationSource,
  ResolvedLocation,
} from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { isCurrent, relationKey, type ResolvedGraph } from '@/lib/insights'
import { normalizePin } from '@/lib/parcels/pin'
import { readString } from '@/lib/format'

/*
  The location resolution cascade. See docs/MAP-SPEC.md section 1.

  Most records in an HOA have no coordinates of their own. A person is not a
  place; they are somewhere because of a lot they live in. So a location is
  resolved rather than stored, and the resolution always reports where it came
  from. A derived location that presents itself as fact is worse than no
  location, because the board will act on it.

  Pure. No map, no network, no React. Everything here survives the Mapbox swap
  untouched.
*/

export const LOCATION_SOURCES = [
  'manual',
  'parcel',
  'residence',
  'ownership',
  'geocoded',
  'related',
  'governed',
] as const satisfies readonly LocationSource[]

export const LOCATION_SOURCE_LABELS: Record<LocationSource, string> = {
  manual: 'Placed by hand',
  parcel: 'From the parcel boundary',
  residence: 'From where they live',
  ownership: 'From a lot they own',
  geocoded: 'From the address on file',
  related: 'From a linked record',
  governed: 'From the lots it governs',
}

export interface ResolveContext {
  graph: ResolvedGraph
  /** Parcel centroid for a PIN, or null when no geometry is on file. */
  centroidForPin: (pin: string | null | undefined) => Point | null
  /** Synchronous geocode. Null is a normal answer. */
  geocode: (address: string | null | undefined) => Point | null
  today?: Date
}

/* ---------------------------------------------------------------- helpers -- */

/**
 * A hand-placed location off the record.
 *
 * Both shapes are accepted because a form produces an object and stored data
 * reads back more naturally as a pair. Anything else is ignored rather than
 * coerced, since a half-parsed coordinate is worse than none.
 */
export function readManualPoint(entity: Entity): Point | null {
  const raw = entity.data.location

  if (Array.isArray(raw) && raw.length === 2) {
    // Indexed rather than destructured: an array read off a JSONB column is
    // unknown[], and destructuring it widens both halves to any.
    const longitude: unknown = raw[0]
    const latitude: unknown = raw[1]
    if (typeof longitude === 'number' && typeof latitude === 'number') {
      return isPlausible([longitude, latitude]) ? [longitude, latitude] : null
    }
    return null
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    const longitude = record.lng ?? record.longitude
    const latitude = record.lat ?? record.latitude
    if (typeof longitude === 'number' && typeof latitude === 'number') {
      return isPlausible([longitude, latitude]) ? [longitude, latitude] : null
    }
  }

  return null
}

/** Rejects a swapped pair or a stray zero, which is the common paste error. */
function isPlausible([longitude, latitude]: Point): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false
  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}

function isPlaceable(entity: Entity | undefined): entity is Entity {
  // Archived and soft-deleted records do not lend their location to anything.
  return Boolean(entity && entity.deletedAt === null && entity.archivedAt === null)
}

/** Records currently linked to `entity` by one of `keys`, in a fixed order. */
function currentlyLinked(
  entity: Entity,
  keys: string[],
  ctx: ResolveContext,
  direction: 'from' | 'to' | 'either' = 'either'
): Entity[] {
  const wanted = new Set(keys)
  const found: Entity[] = []

  for (const relation of ctx.graph.relationsFor.get(entity.id) ?? []) {
    const key = relationKey(relation, ctx.graph)
    if (!key || !wanted.has(key)) continue
    if (!isCurrent(relation, ctx.today)) continue

    const outgoing = relation.fromEntityId === entity.id
    if (direction === 'from' && !outgoing) continue
    if (direction === 'to' && outgoing) continue

    const other = ctx.graph.byId.get(outgoing ? relation.toEntityId : relation.fromEntityId)
    if (isPlaceable(other)) found.push(other)
  }

  // Stable order, so a record with two lots does not move between renders.
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------------------------------------------------------------- cascade -- */

/**
 * Resolution is one hop, then stop. A person resolves through a property and
 * that property resolves through its parcel, but nothing chains further.
 * Deeper chains produce locations nobody can explain.
 */
const MAX_DEPTH = 2

export function resolveLocation(
  entity: Entity,
  ctx: ResolveContext,
  depth = 0
): ResolvedLocation | null {
  const manual = readManualPoint(entity)
  if (manual) {
    return {
      entityId: entity.id,
      point: manual,
      source: 'manual',
      precision: 'exact',
      viaEntityId: null,
      viaEntityName: null,
      explanation: 'Placed by hand on this record',
      pin: readString(entity.data.pin) || null,
    }
  }

  if (depth >= MAX_DEPTH) return null

  const via = (
    other: Entity,
    source: LocationSource,
    explanation: string
  ): ResolvedLocation | null => {
    const borrowed = resolveLocation(other, ctx, depth + 1)
    if (!borrowed) return null
    return {
      entityId: entity.id,
      point: borrowed.point,
      source,
      precision: 'derived',
      viaEntityId: other.id,
      viaEntityName: other.name,
      explanation: `${explanation} ${other.name}`,
      pin: borrowed.pin,
    }
  }

  const byType: Record<EntityType, () => ResolvedLocation | null> = {
    property: () => resolveProperty(entity, ctx),

    person: () => {
      for (const home of currentlyLinked(entity, ['resides_at'], ctx, 'from')) {
        const found = via(home, 'residence', 'Lives at')
        if (found) return found
      }
      for (const lot of currentlyLinked(entity, ['owns'], ctx, 'from')) {
        const found = via(lot, 'ownership', 'Owns')
        if (found) return found
      }
      for (const lot of currentlyLinked(entity, ['related_to'], ctx)) {
        if (lot.type !== 'property') continue
        const found = via(lot, 'related', 'Associated with')
        if (found) return found
      }
      return geocoded(entity, ctx, readString(entity.data.mailingAddress))
    },

    business: () => {
      // A vendor is at its office, not at a lot it happens to hold title to.
      const office = geocoded(entity, ctx, readString(entity.data.mailingAddress))
      if (office) return office

      for (const lot of currentlyLinked(entity, ['owns'], ctx, 'from')) {
        const found = via(lot, 'ownership', 'Owns')
        if (found) return found
      }
      for (const lot of currentlyLinked(entity, ['related_to'], ctx)) {
        if (lot.type !== 'property') continue
        const found = via(lot, 'related', 'Associated with')
        if (found) return found
      }
      return null
    },

    association: () => {
      const office = geocoded(entity, ctx, readString(entity.data.mailingAddress))
      if (office) return office
      return resolveGoverned(entity, ctx)
    },

    asset: () => {
      for (const lot of currentlyLinked(entity, ['adjacent_to', 'owns'], ctx)) {
        if (lot.type !== 'property') continue
        const found = via(lot, 'related', 'On')
        if (found) return found
      }
      for (const owner of currentlyLinked(entity, ['owns'], ctx, 'to')) {
        if (owner.type !== 'association') continue
        const found = resolveGoverned(owner, ctx)
        if (found) {
          return {
            ...found,
            entityId: entity.id,
            source: 'governed',
            precision: 'derived',
            viaEntityId: owner.id,
            viaEntityName: owner.name,
            explanation: `In the common area of ${owner.name}`,
          }
        }
      }
      return null
    },

    record: () => {
      const propertyId = readString(entity.data.propertyId)
      if (propertyId) {
        const property = ctx.graph.byId.get(propertyId)
        if (isPlaceable(property)) {
          const found = via(property, 'related', 'Filed against')
          if (found) return found
        }
      }
      for (const linked of currentlyLinked(entity, ['references', 'related_to'], ctx)) {
        if (linked.type !== 'property') continue
        const found = via(linked, 'related', 'Filed against')
        if (found) return found
      }
      return null
    },

    document: () => {
      for (const linked of currentlyLinked(entity, ['references'], ctx)) {
        if (linked.type !== 'record') continue
        const found = via(linked, 'related', 'Referenced by')
        if (found) return found
      }
      return null
    },
  }

  return byType[entity.type]()
}

function resolveProperty(entity: Entity, ctx: ResolveContext): ResolvedLocation | null {
  const pin = readString(entity.data.pin) || null

  const fromParcel = ctx.centroidForPin(pin)
  if (fromParcel) {
    return {
      entityId: entity.id,
      point: fromParcel,
      source: 'parcel',
      precision: 'exact',
      viaEntityId: null,
      viaEntityName: null,
      explanation: 'From the recorded parcel boundary',
      pin,
    }
  }

  const situs = readString(entity.data.situsAddress) || entity.name
  const geocode = ctx.geocode(situs)
  if (geocode) {
    return {
      entityId: entity.id,
      point: geocode,
      source: 'geocoded',
      precision: 'derived',
      viaEntityId: null,
      viaEntityName: null,
      explanation: `Located from the address ${situs}`,
      pin,
    }
  }

  return null
}

function geocoded(entity: Entity, ctx: ResolveContext, address: string): ResolvedLocation | null {
  if (address === '') return null
  const point = ctx.geocode(address)
  if (!point) return null

  return {
    entityId: entity.id,
    point,
    source: 'geocoded',
    precision: 'derived',
    viaEntityId: null,
    viaEntityName: null,
    explanation: `Located from the address ${address}`,
    pin: null,
  }
}

/** The mean of every lot an association currently governs. */
function resolveGoverned(association: Entity, ctx: ResolveContext): ResolvedLocation | null {
  const lots = currentlyLinked(association, ['governs'], ctx, 'from').filter(
    (candidate) => candidate.type === 'property'
  )

  const points: Point[] = []
  for (const lot of lots) {
    const point = ctx.centroidForPin(readString(lot.data.pin))
    if (point) points.push(point)
  }

  if (points.length === 0) return null

  const longitude = points.reduce((total, [value]) => total + value, 0) / points.length
  const latitude = points.reduce((total, [, value]) => total + value, 0) / points.length

  return {
    entityId: association.id,
    point: [longitude, latitude],
    source: 'governed',
    precision: 'derived',
    viaEntityId: null,
    viaEntityName: null,
    explanation: `Centre of the ${points.length} lots it governs`,
    pin: null,
  }
}

/* ------------------------------------------------------------------- bulk -- */

/**
 * Resolves every active record once. The map needs the whole picture, and
 * resolving per component would repeat the same walk dozens of times.
 */
export function resolveAllLocations(ctx: ResolveContext): LocationIndex {
  const byEntity = new Map<string, ResolvedLocation>()
  const propertyByPin = new Map<string, Entity>()
  const unplaced: Entity[] = []

  for (const entity of ctx.graph.entities) {
    if (!isPlaceable(entity)) continue

    if (entity.type === 'property') {
      /*
        Normalised, because every lookup normalises. The plat asks with the PIN
        off a parcel polygon, which has been through normalizePin, and a map
        keyed on whatever was typed into the record answers nothing for
        `20003-15001` when the county wrote `20003 15001`.
      */
      const pin = readString(entity.data.pin)
      if (pin) propertyByPin.set(normalizePin(pin), entity)
    }

    const resolved = resolveLocation(entity, ctx)
    if (resolved) byEntity.set(entity.id, resolved)
    else unplaced.push(entity)
  }

  unplaced.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))

  return { byEntity, propertyByPin, unplaced }
}
