import type { Entity } from '@/lib/data/types'
import { readString } from '@/lib/format'
import type { ResolvedGraph } from '@/lib/insights'

export const TODO_RECORD_TYPE = 'todo'

export function isTodo(entity: Entity): boolean {
  return entity.type === 'record' && readString(entity.data.recordType) === TODO_RECORD_TYPE
}

/** Active reminder records belonging to one person or business. */
export function todosForSubject(graph: ResolvedGraph, subjectId: string): Entity[] {
  return graph.entities
    .filter(
      (entity) =>
        isTodo(entity) &&
        entity.deletedAt === null &&
        entity.archivedAt === null &&
        readString(entity.data.subjectId) === subjectId
    )
    .sort((a, b) => {
      const aClosed = readString(a.data.status) === 'closed'
      const bClosed = readString(b.data.status) === 'closed'
      if (aClosed !== bClosed) return Number(aClosed) - Number(bClosed)
      const aDue = readString(a.data.followUpDate) || '9999-12-31'
      const bDue = readString(b.data.followUpDate) || '9999-12-31'
      return aDue.localeCompare(bDue) || a.name.localeCompare(b.name)
    })
}
