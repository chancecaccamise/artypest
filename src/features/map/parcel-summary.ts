import type { Entity, LocationIndex } from '@/lib/data/types'
import { normalizePin } from '@/lib/parcels/pin'
import { isCurrent, relationKey, type ResolvedGraph } from '@/lib/insights'

export interface ParcelRecordLink {
  id: string
  label: string
  entity: Entity
  relationKey: string
  /** Set when the person is reached through a business located on the parcel. */
  viaBusiness: Entity | null
}

const DISPLAYED_TYPES = new Set<Entity['type']>(['person', 'business', 'association'])
const TYPE_ORDER: Record<'business' | 'person' | 'association', number> = {
  business: 0,
  person: 1,
  association: 2,
}
const RELATION_ORDER: Record<string, number> = {
  owns: 0,
  resides_at: 1,
  related_to: 2,
  member_of: 3,
  governs: 4,
}

/**
 * The records a reader means by “what is at this parcel”.
 *
 * Direct parcel relationships come first. A business's current people are
 * included one hop later so selecting a business location does not stop at a
 * company name when the supplied contact is the useful person to call.
 */
export function recordsAtParcel(property: Entity, graph: ResolvedGraph): ParcelRecordLink[] {
  if (property.type !== 'property') return []

  const rows: ParcelRecordLink[] = []
  const seen = new Set<string>()
  const directIndex = new Map<string, number>()

  for (const relation of graph.relationsFor.get(property.id) ?? []) {
    if (!isCurrent(relation)) continue
    const type = graph.typeById.get(relation.relationTypeId)
    if (!type) continue

    const outgoing = relation.fromEntityId === property.id
    const other = graph.byId.get(outgoing ? relation.toEntityId : relation.fromEntityId)
    if (!other || !DISPLAYED_TYPES.has(other.type)) continue

    const candidate: ParcelRecordLink = {
      id: relation.id,
      label: outgoing ? type.label : type.reverseLabel,
      entity: other,
      relationKey: type.key,
      viaBusiness: null,
    }

    const existingIndex = directIndex.get(other.id)
    if (existingIndex !== undefined) {
      const existing = rows[existingIndex]
      const nextRank = RELATION_ORDER[candidate.relationKey] ?? 99
      const existingRank = existing ? (RELATION_ORDER[existing.relationKey] ?? 99) : 99
      if (nextRank < existingRank) rows[existingIndex] = candidate
      continue
    }

    directIndex.set(other.id, rows.length)
    rows.push(candidate)
    seen.add(other.id)
  }

  const businesses = rows.filter((row) => row.entity.type === 'business')
  for (const businessRow of businesses) {
    for (const relation of graph.relationsFor.get(businessRow.entity.id) ?? []) {
      if (!isCurrent(relation) || relationKey(relation, graph) !== 'employed_by') continue
      const outgoing = relation.fromEntityId === businessRow.entity.id
      const other = graph.byId.get(outgoing ? relation.toEntityId : relation.fromEntityId)
      if (!other || other.type !== 'person' || seen.has(other.id)) continue

      rows.push({
        id: `${businessRow.id}:${relation.id}`,
        label: `contact for ${businessRow.entity.name}`,
        entity: other,
        relationKey: 'employed_by',
        viaBusiness: businessRow.entity,
      })
      seen.add(other.id)
    }
  }

  return rows.sort((a, b) => {
    const aOrder = TYPE_ORDER[a.entity.type as keyof typeof TYPE_ORDER] ?? 3
    const bOrder = TYPE_ORDER[b.entity.type as keyof typeof TYPE_ORDER] ?? 3
    return aOrder - bOrder || a.entity.name.localeCompare(b.entity.name)
  })
}

/** Native SVG hover text: business first, then the best-supported person name. */
export function parcelHoverLabel(property: Entity, graph: ResolvedGraph): string {
  const rows = recordsAtParcel(property, graph)
  const businesses = rows.filter(
    (row) => row.entity.type === 'business' && row.viaBusiness === null
  )
  const explicitOwners = rows.filter(
    (row) => row.entity.type === 'person' && row.relationKey === 'owns'
  )
  const people =
    explicitOwners.length > 0 ? explicitOwners : rows.filter((row) => row.entity.type === 'person')

  const names = [...businesses, ...people].map((row) => row.entity.name)
  return names.length > 0 ? [...new Set(names)].join(' — ') : property.name
}

/** A placed dot opens its parcel when its resolved location carries a PIN. */
export function parcelForLocatedRecord(entityId: string, locations: LocationIndex): Entity | null {
  const pin = locations.byEntity.get(entityId)?.pin
  return pin ? (locations.propertyByPin.get(normalizePin(pin)) ?? null) : null
}
