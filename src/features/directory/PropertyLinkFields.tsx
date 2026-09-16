import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { useAllEntities } from '@/hooks/use-data'
import type { EntityType } from '@/lib/data/types'
import { buildSearchIndex, searchEntities } from '@/lib/search'

export type PropertyRelationKey = 'owns' | 'resides_at' | 'related_to'

export interface PendingPropertyLink {
  propertyId: string
  relationKey: PropertyRelationKey
}

interface PropertyLinkFieldsProps {
  type: Extract<EntityType, 'person' | 'business'>
  value: PendingPropertyLink[]
  onChange: (value: PendingPropertyLink[]) => void
}

const LABELS: Record<PropertyRelationKey, string> = {
  owns: 'Owns',
  resides_at: 'Lives at',
  related_to: 'Associated with',
}

export function PropertyLinkFields({ type, value, onChange }: PropertyLinkFieldsProps) {
  const entities = useAllEntities()
  const [relationKey, setRelationKey] = useState<PropertyRelationKey>('owns')
  const [query, setQuery] = useState('')

  const properties = useMemo(() => {
    const rows = (entities.data ?? []).filter(
      (entity) =>
        entity.type === 'property' && entity.archivedAt === null && entity.deletedAt === null
    )
    return {
      index: buildSearchIndex(rows),
      byId: new Map(rows.map((property) => [property.id, property])),
    }
  }, [entities.data])

  const hits = useMemo(
    () => searchEntities(properties.index, properties.byId, query, { type: 'property', limit: 8 }),
    [properties, query]
  )

  const add = (propertyId: string) => {
    const duplicate = value.some(
      (link) => link.propertyId === propertyId && link.relationKey === relationKey
    )
    if (!duplicate) onChange([...value, { propertyId, relationKey }])
    setQuery('')
  }

  return (
    <section className="border-rule border-t pt-4">
      <div className="mb-3">
        <h3 className="font-display text-ink text-sm font-bold">Properties</h3>
        <p className="text-ink-muted mt-0.5 text-xs">
          Link one or more properties now so this record is placed on the map automatically.
        </p>
      </div>

      {value.length > 0 ? (
        <ul className="border-rule divide-rule mb-4 divide-y rounded-[3px] border">
          {value.map((link) => {
            const property = properties.byId.get(link.propertyId)
            if (!property) return null
            return (
              <li
                key={`${link.relationKey}:${link.propertyId}`}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-ink text-13 block truncate font-medium">
                    {property.name}
                  </span>
                  <span className="text-ink-muted block text-xs">{LABELS[link.relationKey]}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${LABELS[link.relationKey]} ${property.name}`}
                  onClick={() => onChange(value.filter((candidate) => candidate !== link))}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
        <Field label="Relationship">
          <Select
            value={relationKey}
            onChange={(event) => setRelationKey(event.target.value as PropertyRelationKey)}
          >
            <option value="owns">Owns</option>
            {type === 'person' ? <option value="resides_at">Lives at</option> : null}
            <option value="related_to">Associated with</option>
          </Select>
        </Field>

        <Field label="Find a property" hint="Search by address, parcel number, or lot number.">
          <Input
            type="search"
            value={query}
            placeholder="Start typing an address"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
      </div>

      {query.trim() !== '' ? (
        <ul
          className="border-rule divide-rule mt-2 max-h-52 divide-y overflow-y-auto rounded-[3px] border"
          aria-label="Property results"
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
