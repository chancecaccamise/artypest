import type { Relation, RelationType, RelationTypeInput, RelationTypePatch } from '@/lib/data/types'

/*
  The rules for the board's own connection types, in one place.

  Both providers apply them before writing, and the database applies the ones
  that matter again (20261020120000_editable_relation_types.sql), so a refusal
  reads the same in the demo as in the shared records and is never the first
  thing Postgres says.
*/

/** "Is a tenant of" as it is stored: trimmed, single spaced, lower case first. */
export function normalizeLabel(label: string): string {
  const tidy = label.trim().replace(/\s+/g, ' ')
  // "HOA liaison for" keeps its capitals; "Mentors" reads as "mentors" mid-sentence.
  const acronym = /^[A-Z]{2}/.test(tidy)
  return acronym ? tidy : tidy.charAt(0).toLowerCase() + tidy.slice(1)
}

/** The stored key, so rewording a type later never touches a connection. */
export function relationTypeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export type RelationTypePlan =
  | { kind: 'create'; key: string; label: string; reverseLabel: string }
  /** A removed type with the same key, brought back under the new wording. */
  | { kind: 'revive'; id: string; key: string; label: string; reverseLabel: string }

/**
 * What adding `input` means against the types the org has, removed ones included.
 *
 * Throws, in words a board member can act on, for a blank name or one a current
 * type already has.
 */
export function planRelationType(
  input: RelationTypeInput,
  all: readonly RelationType[]
): RelationTypePlan {
  const label = normalizeLabel(input.label)
  const key = relationTypeKey(label)
  if (key === '') throw new Error('Give the connection a name with letters or numbers in it.')
  // Left blank, a connection reads the same from both ends, as "is related to" does.
  const reverseLabel = normalizeLabel(input.reverseLabel) || label

  const existing = all.find((type) => type.key === key)
  if (existing && existing.deletedAt === null) {
    throw new Error(`There is already a connection type called "${existing.label}".`)
  }
  return existing
    ? { kind: 'revive', id: existing.id, key, label, reverseLabel }
    : { kind: 'create', key, label, reverseLabel }
}

/** The patch as it will be stored. Throws for a label cleared to nothing. */
export function normalizePatch(patch: RelationTypePatch): RelationTypePatch {
  const result: RelationTypePatch = {}
  if (patch.label !== undefined) {
    result.label = normalizeLabel(patch.label)
    if (result.label === '') throw new Error('A connection type needs a name.')
  }
  if (patch.reverseLabel !== undefined) {
    result.reverseLabel = normalizeLabel(patch.reverseLabel)
    if (result.reverseLabel === '') throw new Error('Say how the connection reads the other way.')
  }
  return result
}

/** Current connections of each type, by type id. */
export function usageByType(relations: readonly Relation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const relation of relations) {
    if (relation.deletedAt !== null) continue
    counts.set(relation.relationTypeId, (counts.get(relation.relationTypeId) ?? 0) + 1)
  }
  return counts
}

/** Why a type cannot be removed, or null when it can. */
export function removalBlocker(type: RelationType, inUse: number): string | null {
  if (type.builtIn) {
    return `"${type.label}" is built in. The map and the board roster rely on it, so it can be reworded but not removed.`
  }
  if (inUse > 0) {
    const connections = inUse === 1 ? '1 connection uses' : `${String(inUse)} connections use`
    return `${connections} "${type.label}". Change or remove ${inUse === 1 ? 'it' : 'them'} first.`
  }
  return null
}
