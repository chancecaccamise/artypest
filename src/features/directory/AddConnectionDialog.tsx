import { useMemo, useState } from 'react'

import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { useAllEntities, useCreateRelation, useRelationTypes } from '@/hooks/use-data'
import { buildSearchIndex, searchEntities } from '@/lib/search'
import { ENTITY_TYPE_LABELS, type Entity, type RelationType } from '@/lib/data/types'
import { cn } from '@/lib/utils'

/*
  Connecting one record to another.

  Bidirectionality is a read concern, so a relation is stored once with a
  direction and rendered from both ends. That makes direction the one thing this
  dialog must not get wrong: `owns` from a person to a lot is ownership, and the
  same row the other way round says a lot owns a person. So the direction is
  chosen in the reader's own words, using the relation type's own labels, rather
  than being inferred.
*/

const RESULT_LIMIT = 8

export interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
  /** The record the reader is standing on. */
  entity: Entity
}

export function AddConnectionDialog({ open, onClose, entity }: AddConnectionDialogProps) {
  const relationTypes = useRelationTypes()
  const entities = useAllEntities()
  const createRelation = useCreateRelation()

  const [relationTypeId, setRelationTypeId] = useState('')
  /** `out` reads with the forward label, `in` with the reverse. */
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Entity | null>(null)
  const [startDate, setStartDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const types = relationTypes.data ?? []
  const selectedType: RelationType | undefined =
    types.find((candidate) => candidate.id === relationTypeId) ?? types[0]

  const candidates = useMemo(() => {
    const rows = (entities.data ?? []).filter(
      (candidate) => candidate.id !== entity.id && candidate.archivedAt === null
    )
    return { rows, index: buildSearchIndex(rows), byId: new Map(rows.map((row) => [row.id, row])) }
  }, [entities.data, entity.id])

  const hits = useMemo(
    () => searchEntities(candidates.index, candidates.byId, query, { limit: RESULT_LIMIT }),
    [candidates, query]
  )

  const reset = () => {
    setRelationTypeId('')
    setDirection('out')
    setQuery('')
    setTarget(null)
    setStartDate('')
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    if (!selectedType) {
      setError('Choose what kind of connection this is.')
      return
    }
    if (!target) {
      setError('Choose the record to connect to.')
      return
    }

    createRelation.mutate(
      {
        relationTypeId: selectedType.id,
        // The stored direction, which is what makes the labels read correctly
        // from both ends afterwards.
        fromEntityId: direction === 'out' ? entity.id : target.id,
        toEntityId: direction === 'out' ? target.id : entity.id,
        startDate: startDate === '' ? null : startDate,
      },
      {
        onSuccess: close,
        onError: () => setError('That connection could not be saved.'),
      }
    )
  }

  /** The sentence the connection will read as, so there is nothing to guess. */
  const sentence =
    selectedType === undefined
      ? ''
      : direction === 'out'
        ? `${entity.name} ${selectedType.label} ${target?.name ?? '…'}`
        : `${entity.name} ${selectedType.reverseLabel} ${target?.name ?? '…'}`

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a connection"
      description="Ownership, residency, board seats, and vendor contracts all live here."
      size="md"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={createRelation.isPending}>
            {createRelation.isPending ? 'Saving' : 'Add connection'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Kind of connection">
          <Select
            value={selectedType?.id ?? ''}
            onChange={(event) => {
              setRelationTypeId(event.target.value)
              setError(null)
            }}
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>

        {selectedType ? (
          <Field label="Direction" hint="Which way round this reads.">
            <Select
              value={direction}
              onChange={(event) => setDirection(event.target.value === 'in' ? 'in' : 'out')}
            >
              <option value="out">
                {entity.name} {selectedType.label} the other record
              </option>
              <option value="in">
                {entity.name} {selectedType.reverseLabel} the other record
              </option>
            </Select>
          </Field>
        ) : null}

        <Field
          label="Connect to"
          hint="Search by address, name, or parcel number."
        >
          <Input
            type="text"
            value={target ? target.name : query}
            placeholder="Start typing"
            onChange={(event) => {
              setQuery(event.target.value)
              setTarget(null)
              setError(null)
            }}
          />
        </Field>

        {target === null && query.trim() !== '' ? (
          <ul className="border-rule divide-rule max-h-56 divide-y overflow-y-auto rounded-[3px] border">
            {hits.length === 0 ? (
              <li className="text-ink-muted px-3 py-2 text-13">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </li>
            ) : (
              hits.map((hit) => (
                <li key={hit.entity.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(hit.entity)
                      setQuery('')
                    }}
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
        ) : null}

        <Field label="Since" hint="Optional. When this became true.">
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>

        {target && selectedType ? (
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
  )
}
