import type { RelationType } from '@/lib/data/types'

/*
  A connection as the reader says it, from the record they are standing on.

  One stored relation type reads two ways: `employed_by` is "is employed by"
  from the person and "employs" from the business. The board thinks in those
  sentences, not in a type plus a direction, so the dialog offers the sentences
  and each one carries the type and direction that produce it.
*/

export type ReadingDirection = 'out' | 'in'

export type ReadingGroup = 'main' | 'reverse' | 'other'

export interface ConnectionReading {
  /** Stable for a select's value: the type id and the direction. */
  id: string
  relationTypeId: string
  /** `out` stores the current record as `from`, `in` stores it as `to`. */
  direction: ReadingDirection
  /** The label as it reads, lower case, as stored on the type. */
  label: string
  group: ReadingGroup
}

/** The board's list, in the board's order. */
const MAIN: readonly [string, ReadingDirection][] = [
  ['owns', 'out'],
  ['resides_at', 'out'],
  ['rents', 'out'],
  ['member_of', 'out'],
  ['executive_of', 'out'],
  ['governs', 'out'],
  ['employed_by', 'in'],
  ['employed_by', 'out'],
  ['related_to', 'out'],
  ['vendor_for', 'out'],
  ['vendor_for', 'in'],
]

export const READING_GROUP_LABELS: Record<ReadingGroup, string> = {
  main: 'Connections',
  reverse: 'The other way round',
  other: 'Other kinds',
}

function readingId(type: RelationType, direction: ReadingDirection): string {
  return `${type.id}:${direction}`
}

function reading(
  type: RelationType,
  direction: ReadingDirection,
  group: ReadingGroup
): ConnectionReading {
  return {
    id: readingId(type, direction),
    relationTypeId: type.id,
    direction,
    label: direction === 'out' ? type.label : type.reverseLabel,
    group,
  }
}

/** A type that reads the same both ways needs offering only once. */
function isSymmetric(type: RelationType): boolean {
  return type.label === type.reverseLabel
}

/**
 * Every way a connection can be read, grouped for a select.
 *
 * The board's list first. Then the other end of each of those, because on a
 * property page the useful sentence is "is owned by", not "owns". Then every
 * other type the org has, including any it added itself, so nothing that can
 * be stored is impossible to choose.
 */
export function connectionReadings(types: readonly RelationType[]): ConnectionReading[] {
  const byKey = new Map(types.map((type) => [type.key, type]))
  const offered = new Set<string>()
  const result: ConnectionReading[] = []

  const offer = (type: RelationType, direction: ReadingDirection, group: ReadingGroup) => {
    if (direction === 'in' && isSymmetric(type)) return
    const id = readingId(type, direction)
    if (offered.has(id)) return
    offered.add(id)
    result.push(reading(type, direction, group))
  }

  for (const [key, direction] of MAIN) {
    const type = byKey.get(key)
    if (type) offer(type, direction, 'main')
  }

  const mainKeys = new Set(MAIN.map(([key]) => key))
  for (const [key, direction] of MAIN) {
    const type = byKey.get(key)
    if (type) offer(type, direction === 'out' ? 'in' : 'out', 'reverse')
  }

  for (const type of types) {
    if (mainKeys.has(type.key)) continue
    offer(type, 'out', 'other')
    offer(type, 'in', 'other')
  }

  return result
}

/** The reading an existing relation has from `entityId`'s end. */
export function readingFor(
  relation: { relationTypeId: string; fromEntityId: string },
  entityId: string,
  types: readonly RelationType[]
): string {
  const type = types.find((candidate) => candidate.id === relation.relationTypeId)
  const outgoing = relation.fromEntityId === entityId
  // A symmetric type is only offered going out, whichever end stored it.
  const direction: ReadingDirection = outgoing || (type && isSymmetric(type)) ? 'out' : 'in'
  return `${relation.relationTypeId}:${direction}`
}

/** "is owned by" as an option label: "Is owned by". */
export function readingLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1)
}
