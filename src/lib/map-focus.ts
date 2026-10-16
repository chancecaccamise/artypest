import type { Entity } from '@/lib/data/types'
import type { ResolvedGraph } from '@/lib/insights'

/**
 * Where the Connection Map opens when no record is named: the association,
 * because everything hangs off it.
 *
 * This used to look only for an HOA and otherwise take the first record
 * loaded, so a neighborhood association's map opened on a random parcel with
 * nothing connected to it. The org's own association comes first, then any
 * HOA, then whichever record has the most connections, never one with none
 * while another has some.
 */
export function startingRecord(graph: ResolvedGraph, orgName: string | null): Entity | null {
  const active = graph.entities.filter(
    (entity) => entity.deletedAt === null && entity.archivedAt === null
  )
  const associations = active.filter((entity) => entity.type === 'association')
  const own =
    associations.find((entity) => orgName !== null && entity.name === orgName) ??
    associations.find((entity) => entity.data.associationType === 'hoa')
  if (own) return own

  const connections = (entity: Entity) => graph.relationsFor.get(entity.id)?.length ?? 0
  let busiest: Entity | null = null
  for (const entity of active) {
    if (connections(entity) > (busiest ? connections(busiest) : 0)) busiest = entity
  }
  return busiest ?? active[0] ?? null
}
