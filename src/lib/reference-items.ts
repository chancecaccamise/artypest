import {
  REFERENCE_LIST_FIELDS,
  type Entity,
  type ReferenceItem,
  type ReferenceList,
} from '@/lib/data/types'

/*
  The rules for removing an item from one of the org's own lists, shared by
  both providers and the Settings page, as src/lib/relations/editing.ts is for
  relation types. The database holds the same rule again
  (20261020140000_removable_list_items.sql).
*/

/** Records holding each value of `list`, deleted records left out. */
export function referenceUsage(
  entities: readonly Entity[],
  list: ReferenceList
): Map<string, number> {
  const { type, field } = REFERENCE_LIST_FIELDS[list]
  const counts = new Map<string, number>()
  for (const entity of entities) {
    if (entity.type !== type || entity.deletedAt !== null) continue
    const value = entity.data[field]
    if (typeof value !== 'string' || value === '') continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

/** Why `item` cannot be removed, or null when it can. */
export function referenceRemovalBlocker(item: ReferenceItem, inUse: number): string | null {
  if (inUse === 0) return null
  const records = inUse === 1 ? '1 record uses' : `${String(inUse)} records use`
  return `${records} "${item.label}". Change ${inUse === 1 ? 'it' : 'them'} first, or turn off "Offered" to stop it being chosen for new ones.`
}
