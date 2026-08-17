import { Crosshair, MapPin, MapPinOff } from 'lucide-react'

import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LOCATION_SOURCE_LABELS } from '@/lib/locations/resolve'
import { isWithinPlat } from '@/lib/geo'
import type { Entity, ResolvedLocation } from '@/lib/data/types'
import { cn } from '@/lib/utils'

/*
  Where a record is, and where that answer came from.

  A derived location that presents itself as fact is worse than no location,
  because the board will act on it: they will post a notice to a lot the person
  merely owns rather than the one they live in. So the source is always shown,
  never inferred from context, and a derived answer is visibly weaker than an
  exact one.
*/

export interface LocationSourceNoteProps {
  location: ResolvedLocation | null
  entity: Entity
  onPlace?: (entity: Entity) => void
  canEdit?: boolean
  className?: string
  /** `compact` drops the framing, for use inside an existing field grid. */
  variant?: 'panel' | 'compact'
}

export function LocationSourceNote({
  location,
  entity,
  onPlace,
  canEdit = false,
  className,
  variant = 'panel',
}: LocationSourceNoteProps) {
  if (!location) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 text-13',
          variant === 'panel' && 'border-rule rounded-[3px] border border-dashed px-2.5 py-2',
          className
        )}
      >
        <MapPinOff className="text-ink-faint size-4 shrink-0" aria-hidden="true" />
        <span className="text-ink-muted min-w-0 flex-1">
          No location on file, and none can be derived from its connections.
        </span>
        {canEdit && onPlace ? (
          <Button size="sm" onClick={() => onPlace(entity)}>
            <Crosshair className="size-3.5" />
            Set location
          </Button>
        ) : null}
      </div>
    )
  }

  const exact = location.precision === 'exact'
  const offPlat = !isWithinPlat(location.point)

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        variant === 'panel' && 'border-rule rounded-[3px] border px-2.5 py-2',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <MapPin
          className={cn('size-4 shrink-0', exact ? 'text-moss' : 'text-ink-faint')}
          aria-hidden="true"
        />
        <span className="text-ink min-w-0 flex-1 text-13">{location.explanation}</span>

        <StatusBadge tone={exact ? 'moss' : 'neutral'}>
          {exact ? 'exact' : 'derived'}
        </StatusBadge>
      </div>

      <div className="text-ink-faint flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem]">
        <span>{LOCATION_SOURCE_LABELS[location.source]}</span>
        <span>
          {location.point[1].toFixed(5)}, {location.point[0].toFixed(5)}
        </span>
        {offPlat ? <span className="text-amber">outside the platted area</span> : null}
      </div>

      {canEdit && onPlace ? (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onPlace(entity)}>
            {location.source === 'manual' ? 'Move the pin' : 'Override by hand'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
