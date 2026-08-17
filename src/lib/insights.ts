import { daysUntil } from './format'
import type { Entity, EntityType, Relation, RelationType } from './data/types'

/*
  Everything the dashboard derives from entities and relations, as pure
  functions over data the provider already returned.

  It lives here rather than in the widgets for two reasons: the rules are the
  interesting part and deserve tests, and several of these answers move into
  SQL views once Postgres is in place. Keeping them out of components means
  that move touches one file.
*/

export interface Graph {
  entities: Entity[]
  relations: Relation[]
  relationTypes: RelationType[]
}

export interface ResolvedGraph extends Graph {
  byId: Map<string, Entity>
  typeById: Map<string, RelationType>
  typeByKey: Map<string, RelationType>
  /** Relations touching an entity, from either end. */
  relationsFor: Map<string, Relation[]>
}

export function resolveGraph({ entities, relations, relationTypes }: Graph): ResolvedGraph {
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const typeById = new Map(relationTypes.map((type) => [type.id, type]))
  const typeByKey = new Map(relationTypes.map((type) => [type.key, type]))

  const relationsFor = new Map<string, Relation[]>()
  const push = (id: string, relation: Relation) => {
    const list = relationsFor.get(id)
    if (list) list.push(relation)
    else relationsFor.set(id, [relation])
  }

  for (const relation of relations) {
    push(relation.fromEntityId, relation)
    if (relation.toEntityId !== relation.fromEntityId) push(relation.toEntityId, relation)
  }

  return { entities, relations, relationTypes, byId, typeById, typeByKey, relationsFor }
}

/**
 * A relation is current when it has started and has not ended. A missing
 * start date means "as far back as the records go", which is the common case
 * for relationships that predate the association's own records.
 */
export function isCurrent(relation: Relation, today: Date = new Date()): boolean {
  if (relation.deletedAt !== null) return false
  if (relation.startDate && daysUntil(relation.startDate, today) > 0) return false
  if (relation.endDate && daysUntil(relation.endDate, today) < 0) return false
  return true
}

export function relationKey(relation: Relation, graph: ResolvedGraph): string | null {
  return graph.typeById.get(relation.relationTypeId)?.key ?? null
}

/* ------------------------------------------------------------------ stats -- */

export interface DashboardStats {
  lots: number
  residents: number
  ownerOccupied: number
  ownerOccupiedPercent: number
  activeVendors: number
  boardSeatsFilled: number
  boardSeatsTotal: number
  openItems: number
}

export function computeStats(graph: ResolvedGraph, today: Date = new Date()): DashboardStats {
  const active = graph.entities.filter(
    (entity) => entity.deletedAt === null && entity.archivedAt === null
  )

  const properties = active.filter((entity) => entity.type === 'property')
  const propertyIds = new Set(properties.map((entity) => entity.id))

  const residentIds = new Set<string>()
  const vendorIds = new Set<string>()
  let boardSeatsFilled = 0

  for (const relation of graph.relations) {
    if (!isCurrent(relation, today)) continue
    const key = relationKey(relation, graph)

    if (key === 'resides_at' && propertyIds.has(relation.toEntityId)) {
      residentIds.add(relation.fromEntityId)
    }

    if (key === 'vendor_for') {
      const vendor = graph.byId.get(relation.fromEntityId)
      if (vendor?.type === 'business') vendorIds.add(vendor.id)
    }

    // Board membership is not a separate table. It is member_of with role board.
    if (key === 'member_of' && relation.attributes.role === 'board') {
      const member = graph.byId.get(relation.fromEntityId)
      if (member?.type === 'person') boardSeatsFilled += 1
    }
  }

  /*
    Owner-occupied comes from the same classification the occupancy bar uses.
    Counting it separately here produced a tile that said 54% next to a bar
    that said 52%, which is the kind of thing that costs a board's trust in
    everything else on the page.
  */
  const ownerOccupied = computeOccupancy(graph, today).counts.owner_occupied

  const boardSeatsTotal = active
    .filter((entity) => entity.type === 'association')
    .reduce((total, association) => {
      const seats = association.data.boardSeats
      return total + (typeof seats === 'number' ? seats : 0)
    }, 0)

  const openItems = active.filter(
    (entity) => entity.type === 'record' && entity.data.status !== 'closed'
  ).length

  return {
    lots: properties.length,
    residents: [...residentIds].filter((id) => graph.byId.get(id)?.type === 'person').length,
    ownerOccupied,
    ownerOccupiedPercent:
      properties.length === 0 ? 0 : Math.round((ownerOccupied / properties.length) * 100),
    activeVendors: vendorIds.size,
    boardSeatsFilled,
    boardSeatsTotal,
    openItems,
  }
}

/* -------------------------------------------------------- needs attention -- */

export type Urgency = 'overdue' | 'approaching' | 'incomplete'

export interface AttentionItem {
  id: string
  urgency: Urgency
  /** What is wrong, in the board's words. */
  description: string
  /** The date the urgency is measured against, when there is one. */
  date: string | null
  entityId: string
  entityType: EntityType
  source: string
}

const CONTRACT_WINDOW_DAYS = 90
const INSURANCE_WINDOW_DAYS = 60
const TERM_WINDOW_DAYS = 90

const POSITION_LABELS: Record<string, string> = {
  president: 'President',
  'vice president': 'Vice president',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
  chair: 'Chair',
  member: 'Member',
}

export function computeNeedsAttention(
  graph: ResolvedGraph,
  today: Date = new Date()
): AttentionItem[] {
  const items: AttentionItem[] = []
  const active = graph.entities.filter(
    (entity) => entity.deletedAt === null && entity.archivedAt === null
  )
  const activeIds = new Set(active.map((entity) => entity.id))

  const urgencyFor = (days: number): Urgency => (days < 0 ? 'overdue' : 'approaching')

  const propertiesWithOwner = new Set<string>()

  for (const relation of graph.relations) {
    const key = relationKey(relation, graph)
    if (!key) continue

    const from = graph.byId.get(relation.fromEntityId)
    const to = graph.byId.get(relation.toEntityId)
    if (!from || !to) continue

    const current = isCurrent(relation, today)

    if (key === 'owns' && to.type === 'property' && current) {
      propertiesWithOwner.add(to.id)
    }

    if (!current) continue
    if (!activeIds.has(from.id) || !activeIds.has(to.id)) continue

    if (key === 'vendor_for') {
      const contractEnd =
        typeof relation.attributes.contractEndDate === 'string'
          ? relation.attributes.contractEndDate
          : relation.endDate

      if (contractEnd) {
        const days = daysUntil(contractEnd, today)
        if (days <= CONTRACT_WINDOW_DAYS) {
          items.push({
            id: `contract-${relation.id}`,
            urgency: urgencyFor(days),
            description: `${from.name} contract ${days < 0 ? 'ended' : 'ends'}`,
            date: contractEnd,
            entityId: from.id,
            entityType: from.type,
            source: 'Vendor contract',
          })
        }
      }

      const insurance = relation.attributes.insuranceExpiresOn
      if (typeof insurance === 'string') {
        const days = daysUntil(insurance, today)
        if (days <= INSURANCE_WINDOW_DAYS) {
          items.push({
            id: `insurance-${relation.id}`,
            urgency: urgencyFor(days),
            description: `${from.name} insurance ${days < 0 ? 'expired' : 'expires'}`,
            date: insurance,
            entityId: from.id,
            entityType: from.type,
            source: 'Vendor insurance',
          })
        }
      }
    }

    if (key === 'member_of' && relation.endDate && from.type === 'person') {
      const days = daysUntil(relation.endDate, today)
      if (days <= TERM_WINDOW_DAYS) {
        const position =
          typeof relation.attributes.position === 'string' ? relation.attributes.position : 'member'
        items.push({
          id: `term-${relation.id}`,
          urgency: urgencyFor(days),
          description: `${from.name}, ${POSITION_LABELS[position] ?? position} of ${to.name}, term ${days < 0 ? 'ended' : 'ends'}`,
          date: relation.endDate,
          entityId: from.id,
          entityType: from.type,
          source: 'Term ending',
        })
      }
    }
  }

  for (const entity of active) {
    if (entity.type === 'record') {
      const status = entity.data.status
      const followUp = entity.data.followUpDate
      if (status === 'open' && typeof followUp === 'string') {
        const days = daysUntil(followUp, today)
        if (days < 0) {
          items.push({
            id: `record-${entity.id}`,
            urgency: 'overdue',
            description: `${entity.name} is past its follow-up date`,
            date: followUp,
            entityId: entity.id,
            entityType: entity.type,
            source: 'Open record',
          })
        }
      }
    }

    if (entity.type === 'property') {
      if (!propertiesWithOwner.has(entity.id)) {
        items.push({
          id: `no-owner-${entity.id}`,
          urgency: 'incomplete',
          description: `${entity.name} has no current owner on record`,
          date: null,
          entityId: entity.id,
          entityType: entity.type,
          source: 'Missing owner',
        })
      }

      const pin = entity.data.pin
      if (typeof pin !== 'string' || pin.trim() === '') {
        items.push({
          id: `no-pin-${entity.id}`,
          urgency: 'incomplete',
          description: `${entity.name} has no SAGIS parcel number recorded`,
          date: null,
          entityId: entity.id,
          entityType: entity.type,
          source: 'Missing PIN',
        })
      }
    }

    if (entity.type === 'person') {
      const email = entity.data.email
      const phone = entity.data.phone
      const hasEmail = typeof email === 'string' && email.trim() !== ''
      const hasPhone = typeof phone === 'string' && phone.trim() !== ''
      if (!hasEmail && !hasPhone) {
        items.push({
          id: `no-contact-${entity.id}`,
          urgency: 'incomplete',
          description: `${entity.name} has no email and no phone number`,
          date: null,
          entityId: entity.id,
          entityType: entity.type,
          source: 'Missing contact',
        })
      }
    }
  }

  // Overdue first, then what is coming up soonest, then the data gaps.
  const rank: Record<Urgency, number> = { overdue: 0, approaching: 1, incomplete: 2 }

  return items.sort((a, b) => {
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency]
    if (a.date && b.date) return a.date.localeCompare(b.date)
    if (a.date) return -1
    if (b.date) return 1
    return a.description.localeCompare(b.description)
  })
}

/* ------------------------------------------------------------------ board -- */

export interface BoardSeat {
  relationId: string
  personId: string
  personName: string
  position: string
  positionLabel: string
  termEnd: string | null
}

export interface BoardGroup {
  associationId: string
  associationName: string
  seats: BoardSeat[]
  seatCount: number
}

/** President, vice president, treasurer, secretary, then everyone else. */
const POSITION_ORDER = ['president', 'vice president', 'chair', 'treasurer', 'secretary', 'member']

function positionRank(position: string): number {
  const index = POSITION_ORDER.indexOf(position.toLowerCase())
  return index === -1 ? POSITION_ORDER.length : index
}

export function computeBoard(graph: ResolvedGraph, today: Date = new Date()): BoardGroup[] {
  const groups = new Map<string, BoardGroup>()

  for (const relation of graph.relations) {
    if (relationKey(relation, graph) !== 'member_of') continue
    if (relation.attributes.role !== 'board') continue
    if (!isCurrent(relation, today)) continue

    const person = graph.byId.get(relation.fromEntityId)
    const association = graph.byId.get(relation.toEntityId)
    if (!person || person.type !== 'person' || !association) continue
    if (person.archivedAt !== null || person.deletedAt !== null) continue

    const position =
      typeof relation.attributes.position === 'string' ? relation.attributes.position : 'member'

    const group = groups.get(association.id) ?? {
      associationId: association.id,
      associationName: association.name,
      seats: [],
      seatCount: typeof association.data.boardSeats === 'number' ? association.data.boardSeats : 0,
    }

    group.seats.push({
      relationId: relation.id,
      personId: person.id,
      personName: person.name,
      position,
      positionLabel: POSITION_LABELS[position] ?? position,
      termEnd: relation.endDate,
    })

    groups.set(association.id, group)
  }

  for (const group of groups.values()) {
    group.seats.sort(
      (a, b) => positionRank(a.position) - positionRank(b.position) || a.personName.localeCompare(b.personName)
    )
  }

  return [...groups.values()].sort((a, b) => b.seatCount - a.seatCount)
}

/* -------------------------------------------------------------- occupancy -- */

export const OCCUPANCY_SEGMENTS = [
  'owner_occupied',
  'long_term_rental',
  'short_term_rental',
  'vacant_or_unknown',
] as const

export type OccupancySegment = (typeof OCCUPANCY_SEGMENTS)[number]

export const OCCUPANCY_LABELS: Record<OccupancySegment, string> = {
  owner_occupied: 'Owner-occupied',
  long_term_rental: 'Long-term rental',
  short_term_rental: 'Short-term rental',
  vacant_or_unknown: 'Vacant or unknown',
}

export type OccupancyBreakdown = Record<OccupancySegment, number>

/**
 * The occupancy of one lot.
 *
 * Precedence is fixed rather than first-match, so the answer does not depend
 * on the order relations happen to come back in. An owner living in their own
 * lot outranks anything else recorded about it, because that is the question a
 * board actually asks.
 *
 * Exported because the map colours lots one at a time and the dashboard totals
 * them. Both call this, so a lot cannot be owner-occupied on one screen and a
 * rental on another.
 */
export function classifyOccupancy(
  property: Entity,
  graph: ResolvedGraph,
  today: Date = new Date()
): OccupancySegment {
  const touching = graph.relationsFor.get(property.id) ?? []

  const owners = new Set<string>()
  for (const relation of touching) {
    if (!isCurrent(relation, today)) continue
    if (relationKey(relation, graph) !== 'owns') continue
    if (relation.toEntityId !== property.id) continue
    owners.add(relation.fromEntityId)
  }

  let hasResident = false
  let ownerLives = false
  let shortTerm = false

  for (const relation of touching) {
    if (!isCurrent(relation, today)) continue
    if (relationKey(relation, graph) !== 'resides_at') continue
    if (relation.toEntityId !== property.id) continue

    hasResident = true
    if (owners.has(relation.fromEntityId)) ownerLives = true
    if (relation.attributes.occupancy === 'short_term_rental') shortTerm = true
  }

  if (!hasResident) return 'vacant_or_unknown'
  if (ownerLives) return 'owner_occupied'
  if (shortTerm) return 'short_term_rental'
  return 'long_term_rental'
}

export function computeOccupancy(
  graph: ResolvedGraph,
  today: Date = new Date()
): { total: number; counts: OccupancyBreakdown } {
  const properties = graph.entities.filter(
    (entity) =>
      entity.type === 'property' && entity.deletedAt === null && entity.archivedAt === null
  )

  const counts: OccupancyBreakdown = {
    owner_occupied: 0,
    long_term_rental: 0,
    short_term_rental: 0,
    vacant_or_unknown: 0,
  }

  for (const property of properties) {
    counts[classifyOccupancy(property, graph, today)] += 1
  }

  return { total: properties.length, counts }
}
