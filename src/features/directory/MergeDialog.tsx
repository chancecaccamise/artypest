import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { useAllEntities, useGraph, useMergeEntities } from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS, type Entity } from '@/lib/data/types'
import { findDuplicateProperties } from '@/lib/duplicates'
import { formatDate, readString } from '@/lib/format'
import { buildSearchIndex, searchEntities } from '@/lib/search'
import { cn } from '@/lib/utils'

/*
  Folding a duplicate into the record it duplicates.

  The reader picks the other record, then which of the two to keep. Everything
  the other one has moves across: its connections, its to dos, its photographs,
  and any field the kept record leaves blank. Then it is deleted, which is the
  soft delete every record has, so a wrong merge can still be undone from its
  history.
*/

const RESULT_LIMIT = 8

/** County parcel sources, as opposed to a lot typed in by hand. */
const COUNTY_SOURCES = new Set(['imported', 'reconciled'])

export interface MergeDialogProps {
  open: boolean
  onClose: () => void
  /** The record the reader is standing on. */
  entity: Entity
  /** Preselected, from the duplicate notice. */
  initialOther?: Entity | null
}

export function MergeDialog({ open, onClose, entity, initialOther = null }: MergeDialogProps) {
  const navigate = useNavigate()
  const entities = useAllEntities()
  const { graph } = useGraph()
  const merge = useMergeEntities()

  const [query, setQuery] = useState('')
  const [other, setOther] = useState<Entity | null>(null)
  const [keepId, setKeepId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openKey = open ? `${entity.id}:${initialOther?.id ?? ''}` : null
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null)
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey)
    if (openKey !== null) {
      setQuery('')
      setOther(initialOther)
      setKeepId(null)
      setError(null)
    }
  }

  const singular = ENTITY_TYPE_LABELS[entity.type].singular.toLowerCase()

  const candidates = useMemo(() => {
    const rows = (entities.data ?? []).filter(
      (candidate) => candidate.type === entity.type && candidate.id !== entity.id
    )
    return { rows, index: buildSearchIndex(rows), byId: new Map(rows.map((row) => [row.id, row])) }
  }, [entities.data, entity.id, entity.type])

  /* Offered before anything is typed, because for a lot the likely answer is known. */
  const suggestions = useMemo(
    () =>
      entity.type === 'property'
        ? findDuplicateProperties(
            { id: entity.id, name: entity.name, pin: readString(entity.data.pin) },
            candidates.rows
          ).map((match) => match.entity)
        : [],
    [candidates.rows, entity]
  )

  const hits = useMemo(
    () =>
      query.trim() === ''
        ? suggestions.map((row) => ({ entity: row }))
        : searchEntities(candidates.index, candidates.byId, query, { limit: RESULT_LIMIT }),
    [candidates, query, suggestions]
  )

  const connectionCount = (record: Entity) => graph?.relationsFor.get(record.id)?.length ?? 0

  /*
    The county's copy of a lot over one typed in by hand, because the county
    layer is what the plat and the next parcel refresh are keyed on. Then the
    one with more connections, so fewer move. Then the older.
  */
  const suggestedKeep = (a: Entity, b: Entity): Entity => {
    const county = (record: Entity) => COUNTY_SOURCES.has(readString(record.data.parcelSource))
    if (county(a) !== county(b)) return county(a) ? a : b
    const difference = connectionCount(a) - connectionCount(b)
    if (difference !== 0) return difference > 0 ? a : b
    return a.createdAt <= b.createdAt ? a : b
  }

  const keep = other
    ? keepId === other.id
      ? other
      : keepId === entity.id
        ? entity
        : suggestedKeep(entity, other)
    : null
  const drop = keep && other ? (keep.id === entity.id ? other : entity) : null

  const submit = () => {
    if (!keep || !drop) {
      setError(`Choose the ${singular} to merge with.`)
      return
    }
    setError(null)
    merge.mutate(
      { keepId: keep.id, dropId: drop.id },
      {
        onSuccess: (summary) => {
          onClose()
          // The page being read may be the record that was just deleted.
          if (drop.id === entity.id) navigate(entityHref(summary.kept.type, summary.kept.id))
        },
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : 'The merge did not finish. Try again.'),
      }
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Merge duplicate"
      description={`For two records that are the same ${singular}. One is kept, and everything on the other moves onto it.`}
      footer={
        <>
          <Button onClick={onClose} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={merge.isPending || !keep}>
            {merge.isPending ? 'Merging' : keep ? `Merge into ${keep.name}` : 'Merge'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {other === null ? (
          <>
            <Field
              label={`The other ${singular}`}
              hint={
                suggestions.length > 0 && query.trim() === ''
                  ? 'These have the same parcel number or address.'
                  : 'Search by address, name, or parcel number.'
              }
            >
              <Input
                type="text"
                value={query}
                placeholder="Start typing"
                data-autofocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>

            {hits.length > 0 || query.trim() !== '' ? (
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
                        onClick={() => setOther(hit.entity)}
                        className="hover:bg-paper-sunken flex w-full items-center gap-2 px-3 py-1.5 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate text-13">{hit.entity.name}</span>
                          <span className="text-ink-muted block truncate text-xs">
                            {describe(hit.entity, connectionCount(hit.entity))}
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
          </>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="label-caps text-ink-muted mb-2">Which one to keep</legend>
              {[entity, other].map((record) => (
                <label
                  key={record.id}
                  className={cn(
                    'border-rule flex cursor-pointer items-start gap-3 rounded-[3px] border px-3 py-2',
                    keep?.id === record.id && 'border-survey bg-paper-sunken'
                  )}
                >
                  <input
                    type="radio"
                    name="keep"
                    className="mt-1"
                    checked={keep?.id === record.id}
                    onChange={() => setKeepId(record.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block text-13 font-semibold">
                      {record.name}
                      {record.id === entity.id ? (
                        <span className="text-ink-muted font-normal"> (this page)</span>
                      ) : null}
                    </span>
                    <span className="text-ink-muted block text-xs">
                      {describe(record, connectionCount(record))}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {keep && drop ? (
              <p className="border-rule bg-paper-sunken text-ink-muted rounded-[3px] border px-3 py-2 text-13">
                {plural(connectionCount(drop), 'connection')} on {drop.name} move to{' '}
                <span className="text-ink">{keep.name}</span>, with its to dos and images. Fields{' '}
                {keep.name} leaves blank are filled in from it. Then {drop.name} is deleted. It
                stays in the history and can be restored from there.
              </p>
            ) : null}

            {initialOther === null ? (
              <div>
                <Button size="sm" onClick={() => setOther(null)} disabled={merge.isPending}>
                  Choose a different {singular}
                </Button>
              </div>
            ) : null}
          </>
        )}

        {error === null ? null : (
          <p role="alert" className="text-oxblood text-13">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** One line telling two same-named records apart. */
function describe(record: Entity, connections: number): string {
  const pin = readString(record.data.pin)
  return [
    pin ? `PIN ${pin}` : null,
    plural(connections, 'connection'),
    record.reviewedAt ? 'checked' : 'not checked',
    `added ${formatDate(record.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
