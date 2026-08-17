import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'

import { entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@/lib/data/types'
import { cn } from '@/lib/utils'

/*
  Records the cascade could not place.

  Unplaced is a normal state, not an error. A vendor with an out-of-county
  mailing address genuinely has no place on this plat, and hiding that would
  leave the reader believing the map shows everything. So it is surfaced, with
  the fix one click away.
*/

export interface UnplacedTrayProps {
  unplaced: Entity[]
  selectedEntityId: string | null
  onSelect: (entityId: string) => void
  onPlace: (entity: Entity) => void
  canEdit: boolean
}

export function UnplacedTray({
  unplaced,
  selectedEntityId,
  onSelect,
  onPlace,
  canEdit,
}: UnplacedTrayProps) {
  const [typeFilter, setTypeFilter] = useState<EntityType | ''>('')

  const types = useMemo(() => {
    const counts = new Map<EntityType, number>()
    for (const entity of unplaced) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [unplaced])

  const rows = useMemo(
    () => (typeFilter === '' ? unplaced : unplaced.filter((row) => row.type === typeFilter)),
    [unplaced, typeFilter]
  )

  if (unplaced.length === 0) {
    return (
      <div className="text-ink-muted flex items-center gap-2 text-13">
        <MapPinOff className="size-4 shrink-0" aria-hidden="true" />
        Every record has a location.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-ink-muted flex-1 text-13">
          {unplaced.length} records have no location the map can derive.
        </p>
        <label className="sr-only" htmlFor="unplaced-type">
          Filter unplaced by type
        </label>
        <Select
          id="unplaced-type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as EntityType | '')}
          className="h-7 w-auto text-xs"
        >
          <option value="">All types</option>
          {types.map(([type, count]) => (
            <option key={type} value={type}>
              {ENTITY_TYPE_LABELS[type].plural} ({count})
            </option>
          ))}
        </Select>
      </div>

      <ul className="divide-rule border-rule max-h-56 divide-y overflow-y-auto border-t">
        {rows.map((entity) => (
          <li
            key={entity.id}
            className={cn(
              'flex items-center gap-2 py-1.5',
              entity.id === selectedEntityId && 'bg-paper-sunken'
            )}
          >
            <TypeBadge type={entity.type}>{ENTITY_TYPE_LABELS[entity.type].singular}</TypeBadge>

            <button
              type="button"
              onClick={() => onSelect(entity.id)}
              className="text-ink hover:text-survey min-w-0 flex-1 truncate text-left text-13"
            >
              {entity.name}
            </button>

            {canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => onPlace(entity)}>
                Set location
              </Button>
            ) : (
              <Link
                to={entityHref(entity.type, entity.id)}
                className="text-survey text-xs hover:underline"
              >
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
