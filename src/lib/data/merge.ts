import { remapDataIds } from './stable-ids'
import { ENTITY_TYPE_LABELS, type DataProvider, type Entity, type Relation } from './types'

/*
  Two records that turned out to be one.

  Built from the provider's ordinary writes rather than as one database
  function, so each step is audited by the same triggers as a hand edit and the
  history of both records reads as what happened: every connection says it
  moved, the kept record says which fields it gained, and the other one says
  it was deleted. All of it runs as one batch, so Activity groups it as one
  action.

  The merged-away record is soft deleted, not removed, so it can be restored
  from its history like any other delete. It carries `mergedInto` so anything
  that finds it later can say where it went.
*/

/** Fields that are lists, where a merge keeps both sides' entries. */
const LIST_FIELDS = new Set(['images'])

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

export interface MergedData {
  data: Record<string, unknown>
  /** The fields `keep` gained from `drop`. */
  filled: string[]
}

/**
 * `keep`'s fields, with `drop`'s filling only what `keep` leaves blank.
 *
 * Where both have a value, `keep` wins: it is the record the reader chose. Two
 * exceptions, because nothing in them conflicts: images are pooled, and notes
 * are joined, since an internal note on the duplicate was still written about
 * this lot.
 */
export function mergeData(
  keep: Record<string, unknown>,
  drop: Record<string, unknown>
): MergedData {
  const data = { ...keep }
  const filled: string[] = []

  for (const [key, value] of Object.entries(drop)) {
    if (isBlank(value) || key === 'mergedInto') continue
    const current = data[key]

    if (isBlank(current)) {
      data[key] = value
      filled.push(key)
    } else if (LIST_FIELDS.has(key) && Array.isArray(current) && Array.isArray(value)) {
      const existing: unknown[] = current
      const extra = (value as unknown[]).filter((item) => !existing.includes(item))
      if (extra.length > 0) {
        data[key] = [...existing, ...extra]
        filled.push(key)
      }
    } else if (
      key === 'notes' &&
      typeof current === 'string' &&
      typeof value === 'string' &&
      !current.includes(value)
    ) {
      data[key] = `${current}\n\n${value}`
      filled.push(key)
    }
  }

  return { data, filled }
}

export interface MergeSummary {
  kept: Entity
  /** Connections that now start or end at the kept record. */
  moved: number
  /** Connections dropped: the two records to each other, or one the kept record already had. */
  removed: number
  filled: string[]
  /** Other records, such as to dos, that pointed at the merged-away one. */
  references: number
}

function sameConnection(a: Relation, from: string, to: string, typeId: string): boolean {
  return (
    a.deletedAt === null &&
    a.relationTypeId === typeId &&
    a.fromEntityId === from &&
    a.toEntityId === to
  )
}

/** Folds `dropId` into `keepId` and soft deletes it. */
export async function mergeEntities(
  provider: DataProvider,
  keepId: string,
  dropId: string
): Promise<MergeSummary> {
  if (keepId === dropId) throw new Error('A record cannot be merged into itself.')

  const [keep, drop] = await Promise.all([provider.getEntity(keepId), provider.getEntity(dropId)])
  if (!keep || !drop || keep.deletedAt !== null || drop.deletedAt !== null) {
    throw new Error('One of the two records no longer exists. Reload and try again.')
  }
  if (keep.type !== drop.type) {
    const singular = ENTITY_TYPE_LABELS[drop.type].singular.toLowerCase()
    throw new Error(`A ${singular} can only be merged with another ${singular}.`)
  }

  const { result } = await provider.runBatch(async () => {
    const kept = await provider.listRelations(keep.id)
    let moved = 0
    let removed = 0

    for (const relation of await provider.listRelations(drop.id)) {
      const from = relation.fromEntityId === drop.id ? keep.id : relation.fromEntityId
      const to = relation.toEntityId === drop.id ? keep.id : relation.toEntityId

      // The two records connected to each other: once merged it would point at itself.
      if (from === to) {
        await provider.deleteRelation(relation.id)
        removed += 1
        continue
      }

      /*
        Both records owned by the same person, say. The kept one's connection
        stays, and takes the duplicate's start date if it had none. Never its
        end date: that would end a connection the kept record says is current.
      */
      const twin = kept.find((candidate) =>
        sameConnection(candidate, from, to, relation.relationTypeId)
      )
      if (twin) {
        if (twin.startDate === null && relation.startDate !== null) {
          await provider.updateRelation(twin.id, { startDate: relation.startDate })
        }
        await provider.deleteRelation(relation.id)
        removed += 1
        continue
      }

      kept.push(await provider.updateRelation(relation.id, { fromEntityId: from, toEntityId: to }))
      moved += 1
    }

    let references = 0
    for (const entity of await provider.listAllEntities()) {
      if (entity.id === drop.id) continue
      const data = remapDataIds(entity.data, (id) => (id === drop.id ? keep.id : undefined))
      if (data === entity.data) continue
      await provider.updateEntity(entity.id, { data })
      references += 1
    }

    // Read again: a to do that pointed at the duplicate may have been the kept record itself.
    const current = (await provider.getEntity(keep.id)) ?? keep
    const { data, filled } = mergeData(current.data, drop.data)
    const saved = filled.length > 0 ? await provider.updateEntity(keep.id, { data }) : current

    await provider.updateEntity(drop.id, { data: { ...drop.data, mergedInto: keep.id } })
    await provider.deleteEntity(drop.id)

    return { kept: saved, moved, removed, filled, references }
  })

  return result
}
