import type { Entity, LocationIndex, Relation } from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { isCurrent, type ResolvedGraph } from '@/lib/insights'

/*
  Connection arcs. See docs/PLAT-VIEW-SPEC.md section 6.

  Pure geometry. This module never touches SVG: it produces endpoint pairs in
  screen space and a control point, and a caller turns that into whatever
  primitive it draws with. The same output feeds a Mapbox line layer later,
  where only the drawing changes.
*/

export interface MapArc {
  relationId: string
  relationKey: string
  relationLabel: string
  fromEntityId: string
  toEntityId: string
  fromName: string
  toName: string
  /** Geographic endpoints. Projection happens at render time. */
  from: Point
  to: Point
  /** Ended relations are drawn dashed, like the history divider elsewhere. */
  current: boolean
}

export interface BuildArcsInput {
  graph: ResolvedGraph
  locations: LocationIndex
  /** Relation type keys to include. Empty means none, which is the default. */
  keys: Set<string>
  /** When set, only arcs touching this record are produced. */
  focusEntityId?: string | null
  today?: Date
}

/** How many arcs are worth drawing before the plat stops being readable. */
export const ARC_LIMIT = 400

export function buildArcs({
  graph,
  locations,
  keys,
  focusEntityId,
  today,
}: BuildArcsInput): MapArc[] {
  if (keys.size === 0) return []

  const arcs: MapArc[] = []

  for (const relation of graph.relations) {
    if (relation.deletedAt !== null) continue

    const type = graph.typeById.get(relation.relationTypeId)
    if (!type || !keys.has(type.key)) continue

    if (
      focusEntityId &&
      relation.fromEntityId !== focusEntityId &&
      relation.toEntityId !== focusEntityId
    ) {
      continue
    }

    const from = locations.byEntity.get(relation.fromEntityId)
    const to = locations.byEntity.get(relation.toEntityId)
    // An arc needs two ends. A relation to an unplaced record is not drawn,
    // and the Unplaced tray is where that fact is reported instead.
    if (!from || !to) continue

    // A record and the lot it borrowed its location from sit on the same
    // point, so the arc would be a dot. Those are the least informative arcs
    // on the plat and are dropped rather than drawn as noise.
    if (from.point[0] === to.point[0] && from.point[1] === to.point[1]) continue

    const fromEntity = graph.byId.get(relation.fromEntityId)
    const toEntity = graph.byId.get(relation.toEntityId)
    if (!fromEntity || !toEntity) continue

    arcs.push({
      relationId: relation.id,
      relationKey: type.key,
      relationLabel: type.label,
      fromEntityId: relation.fromEntityId,
      toEntityId: relation.toEntityId,
      fromName: fromEntity.name,
      toName: toEntity.name,
      from: from.point,
      to: to.point,
      current: isCurrent(relation, today),
    })

    if (arcs.length >= ARC_LIMIT) break
  }

  return arcs
}

/**
 * A quadratic bezier between two projected points.
 *
 * The control point is offset perpendicular to the midpoint, by a fraction of
 * the endpoint distance, so short links stay nearly flat and long ones bow.
 * A fixed offset would make neighbouring lots look connected by a rainbow.
 */
export function arcPath(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  curvature = 0.18
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const distance = Math.hypot(dx, dy)

  if (distance === 0) return `M ${x1},${y1}`

  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  // Perpendicular unit vector, consistently to one side so parallel arcs
  // between the same pair of lots do not overlap each other.
  const offset = distance * curvature
  const controlX = midX + (-dy / distance) * offset
  const controlY = midY + (dx / distance) * offset

  const round = (value: number) => Math.round(value * 100) / 100

  return `M ${round(x1)},${round(y1)} Q ${round(controlX)},${round(controlY)} ${round(x2)},${round(y2)}`
}

/** Arc colour by relation type. Tokens only, never a generated scale. */
export const ARC_COLORS: Record<string, string> = {
  owns: 'var(--type-property)',
  resides_at: 'var(--type-person)',
  member_of: 'var(--type-association)',
  vendor_for: 'var(--type-business)',
  employed_by: 'var(--type-business)',
  manages: 'var(--type-asset)',
  governs: 'var(--type-association)',
  adjacent_to: 'var(--rule-strong)',
  related_to: 'var(--type-record)',
  references: 'var(--type-document)',
}

export function arcColor(key: string): string {
  return ARC_COLORS[key] ?? 'var(--rule-strong)'
}

/** Relation type keys worth offering, ordered by how often a board asks. */
export function arcableKeys(graph: ResolvedGraph, locations: LocationIndex): string[] {
  const counts = new Map<string, number>()

  for (const relation of graph.relations) {
    if (relation.deletedAt !== null) continue
    const type = graph.typeById.get(relation.relationTypeId)
    if (!type) continue
    if (!locations.byEntity.has(relation.fromEntityId)) continue
    if (!locations.byEntity.has(relation.toEntityId)) continue
    counts.set(type.key, (counts.get(type.key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

export interface UndrawnCounts {
  /** One end has no location at all. */
  unplacedEnd: number
  /** Both ends resolve to the same point, so the arc would be a dot. */
  sameLocation: number
}

/**
 * Why a relation of a switched-on type is not on the drawing.
 *
 * Both reasons are reported because they mean different things. An unplaced
 * end is a gap in the records. Two ends on the same point is the normal case
 * for an owner who lives in the lot they own, and a reader who switches on
 * "owns" and sees five arcs across forty lots deserves to know which it is.
 */
export function undrawnCounts(
  graph: ResolvedGraph,
  locations: LocationIndex,
  keys: Set<string>
): UndrawnCounts {
  const counts: UndrawnCounts = { unplacedEnd: 0, sameLocation: 0 }

  for (const relation of graph.relations) {
    if (relation.deletedAt !== null) continue
    const type = graph.typeById.get(relation.relationTypeId)
    if (!type || !keys.has(type.key)) continue

    const from = locations.byEntity.get(relation.fromEntityId)
    const to = locations.byEntity.get(relation.toEntityId)

    if (!from || !to) counts.unplacedEnd += 1
    else if (from.point[0] === to.point[0] && from.point[1] === to.point[1]) {
      counts.sameLocation += 1
    }
  }

  return counts
}

export type { Entity, Relation }
