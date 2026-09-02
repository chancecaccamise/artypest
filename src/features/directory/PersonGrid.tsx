import { useMemo, useState } from 'react'

import { EntityFormDialog } from './EntityFormDialog'
import { PersonCard, type ConnectionCounts } from './PersonCard'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  useAllEntities,
  useArchiveEntity,
  useDeleteEntity,
  useRelations,
  useRestoreEntity,
  useReviewIndex,
} from '@/hooks/use-data'
import type { Entity, EntityType } from '@/lib/data/types'
import { stateFor } from '@/lib/review/status'

/*
  The people directory as cards.

  A table is the right shape for ten thousand parcels and the wrong one for
  fifty residents. A board member recognises somebody by their face and by what
  they are connected to, and the counts on each card answer the question this
  application exists for without anything having to be opened.
*/

export function PersonGrid({ people }: { people: Entity[] }) {
  const relations = useRelations()
  const entities = useAllEntities()
  const reviewIndex = useReviewIndex()

  const archive = useArchiveEntity()
  const restore = useRestoreEntity()
  const remove = useDeleteEntity()

  const [editing, setEditing] = useState<Entity | null>(null)
  const [deleting, setDeleting] = useState<Entity | null>(null)

  /*
    How many of each kind of record each person is connected to.

    Counted across everyone at once rather than per card, so the work is done
    once per page rather than once per person. Relations are stored one way
    round and read both, so each one counts for whichever end is not the person.
  */
  const countsById = useMemo(() => {
    const typeById = new Map((entities.data ?? []).map((entity) => [entity.id, entity.type]))
    const counts = new Map<string, ConnectionCounts>()

    const bump = (personId: string, type: EntityType) => {
      const existing = counts.get(personId) ?? {}
      existing[type] = (existing[type] ?? 0) + 1
      counts.set(personId, existing)
    }

    const isPerson = new Set(people.map((person) => person.id))

    for (const relation of relations.data ?? []) {
      if (relation.deletedAt !== null) continue

      if (isPerson.has(relation.fromEntityId)) {
        const otherType = typeById.get(relation.toEntityId)
        if (otherType) bump(relation.fromEntityId, otherType)
      }
      if (isPerson.has(relation.toEntityId)) {
        const otherType = typeById.get(relation.fromEntityId)
        if (otherType) bump(relation.toEntityId, otherType)
      }
    }

    return counts
  }, [relations.data, entities.data, people])

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
        {people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            counts={countsById.get(person.id) ?? {}}
            reviewState={stateFor(reviewIndex.data, person.id)}
            reviewStatus={reviewIndex.data?.byEntity.get(person.id)}
            onEdit={setEditing}
            onArchive={(target) => {
              if (target.archivedAt === null) archive.mutate(target.id)
              else restore.mutate(target.id)
            }}
            onDelete={setDeleting}
          />
        ))}
      </ul>

      <EntityFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        type="person"
        entity={editing ?? undefined}
      />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this person'}?`}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-ink-muted text-13">
          {/*
            Soft delete, so this is recoverable and the audit trail keeps it.
            Saying so is the difference between a confident click and a nervous
            one.
          */}
          The record is removed from the directory and kept in the history, so
          this can be undone. Connections to it are removed too.
        </p>
      </Dialog>
    </>
  )
}
