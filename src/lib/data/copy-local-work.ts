import { applyOverlay, buildOverlay, type Overlay } from './persistence'
import { isUuid, remapDataIds, withStableIds } from './stable-ids'
import type { DataSnapshot, Entity, Relation, RelationType } from './types'

/*
  Work typed into one browser before the records were shared, made ready to go
  into the database.

  The browser saved what differed from the starting data, under the ids that
  data had then: readable ones for the county lots and the supplied contacts,
  and whatever the in-browser store handed out for records somebody created
  (a counter once, a prefixed uuid later, a bare uuid now). Every one of those
  becomes the id the shared records use, and every reference to it follows:
  both ends of a connection, and the ids a to do or a record keeps in its data.

  Pure, so it can be checked without a database. SyncedProvider writes the
  result, which is where it is audited.
*/

export interface LocalWork {
  entities: Entity[]
  relations: Relation[]
}

const PREFIXED_UUID = /^(?:ent|rel)-([0-9a-f-]{36})$/i

export function planLocalWork(
  overlay: Overlay,
  /** The starting data as this browser built it, readable ids and all. */
  legacyBaseline: DataSnapshot,
  /** The database's relation types, matched to the browser's by key. */
  sharedTypes: readonly RelationType[]
): LocalWork {
  // Through applyOverlay, so a browser that suffered the id collisions is separated first.
  const local = applyOverlay(legacyBaseline, overlay)
  const changed = buildOverlay(local, legacyBaseline, new Date().toISOString())
  const { idMap } = withStableIds(legacyBaseline)

  const created = new Map<string, string>()
  const idFor = (id: string): string => {
    const stable = idMap.get(id)
    if (stable) return stable
    if (isUuid(id)) return id
    const prefixed = PREFIXED_UUID.exec(id)?.[1]
    if (prefixed && isUuid(prefixed)) return prefixed
    let fresh = created.get(id)
    if (!fresh) {
      fresh = crypto.randomUUID()
      created.set(id, fresh)
    }
    return fresh
  }

  const entities = changed.entities.map((entity) => ({
    ...entity,
    id: idFor(entity.id),
    data: remapDataIds(entity.data, idFor),
  }))

  const keyOf = new Map(legacyBaseline.relationTypes.map((type) => [type.id, type.key]))
  const sharedId = new Map(sharedTypes.map((type) => [type.key, type.id]))
  const relations: Relation[] = []
  for (const relation of changed.relations) {
    const key = keyOf.get(relation.relationTypeId)
    const relationTypeId = key ? sharedId.get(key) : undefined
    // A kind the shared records do not have cannot be stored; nothing in use is.
    if (!relationTypeId) continue
    relations.push({
      ...relation,
      id: idFor(relation.id),
      relationTypeId,
      fromEntityId: idFor(relation.fromEntityId),
      toEntityId: idFor(relation.toEntityId),
    })
  }

  return { entities, relations }
}
