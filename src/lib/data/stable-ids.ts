import { normalizePin } from '@/lib/parcels/pin'
import type { DataSnapshot as DemoData } from './types'
import type { Entity, Relation } from './types'

/*
  Ids the database can hold, that every browser computes the same way.

  The starting data is built in the browser on every load: the county parcels
  from static files, the TSNA contacts from code. Its ids were readable strings
  ("ent-parcel-000123", "ent-tsna-person-7"), and Postgres keys every table on a
  uuid. A record copied into the database the first time somebody edits it has
  to land on the same id that every other browser builds for it, or two admins
  would each copy in their own version of the same lot.

  So the id is derived from what the record is, not from where it sits in a
  list: a parcel from its PIN, which survives a re-harvest that reorders the
  layer, and anything else from its readable id. Relations from their kind and
  their two ends.
*/

/** Fields inside `data` that hold another record's id. */
export const ID_REFERENCE_KEYS = ['subjectId', 'propertyId'] as const

/** 32 bits of a string, seeded. murmur3's finaliser over an FNV-style pass. */
function hash32(input: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let index = 0; index < input.length; index += 1) {
    h = Math.imul(h ^ input.charCodeAt(index), 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * A uuid derived from `key`. The same key always gives the same uuid.
 *
 * Version 8, the RFC 9562 version for ids built by an application's own
 * method, so nothing mistakes it for a random v4.
 */
export function stableUuid(key: string): string {
  const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]
    .map((seed) => hash32(key, seed).toString(16).padStart(8, '0'))
    .join('')
  const version = `8${hex.slice(13, 16)}`
  // The variant: the top two bits of this group are 10.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

function entityKey(entity: Entity): string {
  const pin = typeof entity.data.pin === 'string' ? entity.data.pin : ''
  if (entity.id.startsWith('ent-parcel-') && pin !== '') {
    return `parcel:${normalizePin(pin)}`
  }
  return `entity:${entity.id}`
}

/** Rewrites the id fields inside `data` through `idFor`, leaving the rest alone. */
export function remapDataIds(
  data: Record<string, unknown>,
  idFor: (id: string) => string | undefined
): Record<string, unknown> {
  let next = data
  for (const key of ID_REFERENCE_KEYS) {
    const value = data[key]
    if (typeof value !== 'string') continue
    const mapped = idFor(value)
    if (mapped === undefined || mapped === value) continue
    if (next === data) next = { ...data }
    next[key] = mapped
  }
  return next
}

export interface StableIds {
  data: DemoData
  /** Readable id to stable id, entities and relations both. */
  idMap: Map<string, string>
}

/**
 * The same dataset with every entity and relation on a stable uuid.
 *
 * Relation types and the org keep their ids: those come from the database,
 * which has its own, and are matched up by key when the two are merged.
 */
export function withStableIds(source: DemoData): StableIds {
  const idMap = new Map<string, string>()

  for (const entity of source.entities) {
    idMap.set(entity.id, stableUuid(entityKey(entity)))
  }

  const entities = source.entities.map((entity) => ({
    ...entity,
    id: idMap.get(entity.id) ?? entity.id,
    data: remapDataIds(entity.data, (id) => idMap.get(id)),
  }))

  const typeKey = new Map(source.relationTypes.map((type) => [type.id, type.key]))
  const used = new Set<string>()
  const relations: Relation[] = source.relations.map((relation) => {
    const from = idMap.get(relation.fromEntityId) ?? relation.fromEntityId
    const to = idMap.get(relation.toEntityId) ?? relation.toEntityId
    const base = `relation:${typeKey.get(relation.relationTypeId) ?? relation.relationTypeId}:${from}:${to}`
    // The same two records joined twice the same way, a lease renewed say.
    let key = base
    for (let count = 2; used.has(key); count += 1) key = `${base}:${String(count)}`
    used.add(key)

    const id = stableUuid(key)
    idMap.set(relation.id, id)
    return { ...relation, id, fromEntityId: from, toEntityId: to }
  })

  return { data: { ...source, entities, relations }, idMap }
}
