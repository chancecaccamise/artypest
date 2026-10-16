import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { EntityFormDialog } from '@/features/directory/EntityFormDialog'
import {
  useAllEntities,
  useCreateRelation,
  useRelationTypes,
  useUpdateRelation,
} from '@/hooks/use-data'
import { buildSearchIndex, searchEntities } from '@/lib/search'
import {
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType,
  type Relation,
  type RelationPatch,
} from '@/lib/data/types'
import {
  READING_GROUP_LABELS,
  connectionReadings,
  readingFor,
  readingLabel,
  type ConnectionReading,
  type ReadingGroup,
} from '@/lib/relations/readings'
import { cn } from '@/lib/utils'

/*
  Connecting one record to another, or changing a connection already made.

  Bidirectionality is a read concern, so a relation is stored once with a
  direction and rendered from both ends. That makes direction the one thing this
  dialog must not get wrong: `owns` from a person to a lot is ownership, and the
  same row the other way round says a lot owns a person. So the kind is chosen
  as the sentence the reader would say from this record, "employs" or "is
  employed by", and each sentence carries its own direction.
*/

const RESULT_LIMIT = 8

/** What can be made from here without leaving the dialog. */
const CREATABLE: readonly EntityType[] = ['person', 'property', 'business', 'association']

const GROUP_ORDER: readonly ReadingGroup[] = ['main', 'reverse', 'other']

export interface ConnectionDialogProps {
  open: boolean
  onClose: () => void
  /** The record the reader is standing on. */
  entity: Entity
  /** Present when editing. Absent when adding. */
  relation?: Relation
}

export function ConnectionDialog({ open, onClose, entity, relation }: ConnectionDialogProps) {
  const relationTypes = useRelationTypes()
  const entities = useAllEntities()
  const createRelation = useCreateRelation()
  const updateRelation = useUpdateRelation()

  const [readingId, setReadingId] = useState('')
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Entity | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Set while the record form is open in place of this dialog. */
  const [creating, setCreating] = useState<EntityType | null>(null)

  const types = useMemo(() => relationTypes.data ?? [], [relationTypes.data])
  const readings = useMemo(() => connectionReadings(types), [types])
  const reading: ConnectionReading | undefined =
    readings.find((candidate) => candidate.id === readingId) ?? readings[0]

  const editing = relation !== undefined
  const otherId = relation
    ? relation.fromEntityId === entity.id
      ? relation.toEntityId
      : relation.fromEntityId
    : null

  /*
    Reset whenever the dialog opens, so a cancelled edit does not leak into the
    next one. Not when the record form hands back, which is the same opening.
  */
  const openKey = open ? `${relation?.id ?? 'new'}:${relation?.updatedAt ?? ''}` : null
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null)
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey)
    if (openKey !== null) {
      setReadingId(relation ? readingFor(relation, entity.id, types) : '')
      setQuery('')
      setTarget(null)
      setStartDate(relation?.startDate ?? '')
      setEndDate(relation?.endDate ?? '')
      setError(null)
      setCreating(null)
    }
  }

  const candidates = useMemo(() => {
    const rows = (entities.data ?? []).filter(
      (candidate) => candidate.id !== entity.id && candidate.archivedAt === null
    )
    return { rows, index: buildSearchIndex(rows), byId: new Map(rows.map((row) => [row.id, row])) }
  }, [entities.data, entity.id])

  // When editing, the record already connected until another is chosen, archived or not.
  const current = otherId ? ((entities.data ?? []).find((row) => row.id === otherId) ?? null) : null
  const chosen = target ?? current

  const hits = useMemo(
    () => searchEntities(candidates.index, candidates.byId, query, { limit: RESULT_LIMIT }),
    [candidates, query]
  )

  const pending = createRelation.isPending || updateRelation.isPending

  const submit = () => {
    if (!reading) {
      setError('Choose what kind of connection this is.')
      return
    }
    if (!chosen) {
      setError('Choose the record to connect to.')
      return
    }
    if (startDate !== '' && endDate !== '' && endDate < startDate) {
      setError('The end date is before the start date.')
      return
    }

    // The stored direction, which is what makes the labels read correctly from both ends.
    const ends = {
      fromEntityId: reading.direction === 'out' ? entity.id : chosen.id,
      toEntityId: reading.direction === 'out' ? chosen.id : entity.id,
    }
    const options = {
      onSuccess: onClose,
      onError: () => setError('That connection could not be saved.'),
    }

    if (relation) {
      const patch: RelationPatch = {
        relationTypeId: reading.relationTypeId,
        ...ends,
        startDate: startDate === '' ? null : startDate,
        endDate: endDate === '' ? null : endDate,
      }
      updateRelation.mutate({ id: relation.id, patch }, options)
      return
    }

    createRelation.mutate(
      {
        relationTypeId: reading.relationTypeId,
        ...ends,
        startDate: startDate === '' ? null : startDate,
        endDate: endDate === '' ? null : endDate,
      },
      options
    )
  }

  /** The sentence the connection will read as, so there is nothing to guess. */
  const sentence = reading ? `${entity.name} ${reading.label} ${chosen?.name ?? '…'}` : ''

  const pickTarget = (next: Entity) => {
    setTarget(next)
    setQuery('')
    setError(null)
  }

  return (
    <>
      <Dialog
        open={open && creating === null}
        onClose={onClose}
        title={editing ? 'Edit connection' : 'Add a connection'}
        description={
          editing
            ? 'Every change is recorded in the history of both records.'
            : 'Ownership, residency, board seats, and vendor contracts all live here.'
        }
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? 'Saving' : editing ? 'Save changes' : 'Add connection'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Kind of connection" hint={`How ${entity.name} is connected.`}>
            <Select
              value={reading?.id ?? ''}
              onChange={(event) => {
                setReadingId(event.target.value)
                setError(null)
              }}
            >
              {GROUP_ORDER.map((group) => {
                const inGroup = readings.filter((candidate) => candidate.group === group)
                if (inGroup.length === 0) return null
                return (
                  <optgroup key={group} label={READING_GROUP_LABELS[group]}>
                    {inGroup.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {readingLabel(candidate.label)}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </Select>
          </Field>

          <Field label="Connect to" hint="Search by address, name, or parcel number.">
            <Input
              type="text"
              value={query === '' && chosen ? chosen.name : query}
              placeholder="Start typing"
              onChange={(event) => {
                setQuery(event.target.value)
                setTarget(null)
                setError(null)
              }}
            />
          </Field>

          {query.trim() !== '' ? (
            <div className="border-rule divide-rule divide-y rounded-[3px] border">
              <ul className="divide-rule max-h-56 divide-y overflow-y-auto">
                {hits.length === 0 ? (
                  <li className="text-ink-muted px-3 py-2 text-13">
                    Nothing matches &ldquo;{query.trim()}&rdquo;.
                  </li>
                ) : (
                  hits.map((hit) => (
                    <li key={hit.entity.id}>
                      <button
                        type="button"
                        onClick={() => pickTarget(hit.entity)}
                        className={cn(
                          'hover:bg-paper-sunken flex w-full items-center gap-2 px-3 py-1.5 text-left'
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate text-13">{hit.entity.name}</span>
                          <span className="text-ink-muted block truncate text-xs">
                            {hit.document.detail}
                          </span>
                        </span>
                        <TypeBadge type={hit.entity.type}>
                          {ENTITY_TYPE_LABELS[hit.entity.type].singular}
                        </TypeBadge>
                      </button>
                    </li>
                  ))
                )}
              </ul>

              {/*
                Not on file yet is the usual reason a search comes up empty, and
                leaving to add the record loses everything chosen so far.
              */}
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                <span className="text-ink-muted mr-1 text-xs">Not listed? Add a new</span>
                {CREATABLE.map((type) => (
                  <Button key={type} size="sm" onClick={() => setCreating(type)}>
                    <Plus />
                    {ENTITY_TYPE_LABELS[type].singular}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Since" hint="Optional. When this became true.">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="Until" hint="Optional. Set it when this stops being true.">
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>

          {chosen && reading ? (
            <p className="border-rule bg-paper-sunken text-ink-muted rounded-[3px] border px-3 py-2 text-13">
              This will read: <span className="text-ink">{sentence}</span>
            </p>
          ) : null}

          {error === null ? null : (
            <p role="alert" className="text-oxblood text-13">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      {creating ? (
        <EntityFormDialog
          open
          type={creating}
          initialName={query.trim()}
          onClose={() => setCreating(null)}
          onCreated={(created) => {
            pickTarget(created)
            setCreating(null)
          }}
        />
      ) : null}
    </>
  )
}
