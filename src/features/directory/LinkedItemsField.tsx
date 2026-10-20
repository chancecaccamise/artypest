import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { useAllEntities } from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS } from '@/lib/data/types'
import { buildSearchIndex, searchEntities } from '@/lib/search'

/*
  What a new record is about: the business a letter is to, the lot a
  violation is on, the person who complained.

  Each choice becomes a "references" connection from the record once it is
  saved, which is what puts the record on that item's Records tab and draws it
  on the Connection Map. Nothing new is stored to do it.
*/
export function LinkedItemsField({
  value,
  onChange,
}: {
  /** Entity ids, in the order they were chosen. */
  value: string[]
  onChange: (value: string[]) => void
}) {
  const entities = useAllEntities()
  const [query, setQuery] = useState('')

  const candidates = useMemo(() => {
    const rows = (entities.data ?? []).filter(
      (entity) => entity.archivedAt === null && entity.deletedAt === null
    )
    return { index: buildSearchIndex(rows), byId: new Map(rows.map((row) => [row.id, row])) }
  }, [entities.data])

  const hits = useMemo(
    () =>
      searchEntities(candidates.index, candidates.byId, query, { limit: 8 }).filter(
        (hit) => !value.includes(hit.entity.id)
      ),
    [candidates, query, value]
  )

  const add = (id: string) => {
    onChange([...value, id])
    setQuery('')
  }

  return (
    <section className="border-rule border-t pt-4">
      <div className="mb-3">
        <h3 className="font-display text-ink text-sm font-bold">Linked to</h3>
        <p className="text-ink-muted mt-0.5 text-xs">
          The people, properties, businesses, or associations this record is about. It will be
          listed on each of their Records tabs.
        </p>
      </div>

      {value.length > 0 ? (
        <ul className="border-rule divide-rule mb-4 divide-y rounded-[3px] border">
          {value.map((id) => {
            const linked = candidates.byId.get(id)
            if (!linked) return null
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2">
                <TypeBadge type={linked.type}>{ENTITY_TYPE_LABELS[linked.type].singular}</TypeBadge>
                <span className="text-ink text-13 min-w-0 flex-1 truncate font-medium">
                  {linked.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Unlink ${linked.name}`}
                  onClick={() => onChange(value.filter((candidate) => candidate !== id))}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <Field label="Find in the directory" hint="Search by name, address, or parcel number.">
        <Input
          type="search"
          value={query}
          placeholder="Start typing a name"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      {query.trim() !== '' ? (
        <ul
          className="border-rule divide-rule mt-2 max-h-52 divide-y overflow-y-auto rounded-[3px] border"
          aria-label="Directory results"
        >
          {hits.length === 0 ? (
            <li className="text-ink-muted text-13 px-3 py-2">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </li>
          ) : (
            hits.map((hit) => (
              <li key={hit.entity.id}>
                <button
                  type="button"
                  className="hover:bg-paper-sunken flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={() => add(hit.entity.id)}
                >
                  <TypeBadge type={hit.entity.type}>
                    {ENTITY_TYPE_LABELS[hit.entity.type].singular}
                  </TypeBadge>
                  <span className="text-ink text-13 min-w-0 flex-1 truncate">
                    {hit.entity.name}
                  </span>
                  <span className="text-ink-faint shrink-0 font-mono text-[0.6875rem]">
                    {hit.document.detail}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  )
}
