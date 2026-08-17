import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { LocationSourceNote } from '@/features/map/LocationSourceNote'
import { ParcelRecordCard } from '@/features/parcels/ParcelRecordCard'
import { DIRECTORY_CONFIGS, type FieldDef } from '@/features/directory/config'
import { PhotoPanel } from '@/features/directory/PhotoPanel'
import { useLocation, useSetManualLocation } from '@/hooks/use-data'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import type { Entity, Org } from '@/lib/data/types'
import {
  formatAcreage,
  formatCurrency,
  formatDate,
  humanize,
  readNumber,
  readString,
} from '@/lib/format'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

/*
  The field grid. Two columns on desktop, one on mobile. Empty fields show a
  muted "Not set" rather than being hidden, because a board member needs to
  see that a field is blank, not wonder whether it exists.
*/

export interface DetailsTabProps {
  entity: Entity
  org: Org | undefined
  onAddParcelRecord: () => void
}

function renderValue(
  field: FieldDef,
  raw: unknown,
  labelFor: ReturnType<typeof useReferenceLabels>['labelFor']
): ReactNode {
  const value = readString(raw)
  if (value === '') {
    return <span className="text-ink-faint">Not set</span>
  }

  switch (field.format) {
    case 'date':
      return <span className="font-mono">{formatDate(value)}</span>
    case 'currency':
      return <span className="font-mono">{formatCurrency(readNumber(raw))}</span>
    case 'acreage':
      return <span className="font-mono">{formatAcreage(readNumber(raw))}</span>
    case 'number':
      return <span className="font-mono">{(readNumber(raw) ?? 0).toLocaleString()}</span>
    case 'year':
    case 'mono':
      return <span className="font-mono">{value}</span>
    case 'email':
      return (
        <a href={`mailto:${value}`} className="text-survey hover:underline">
          {value}
        </a>
      )
    case 'phone':
      return (
        <a href={`tel:${value}`} className="text-survey font-mono hover:underline">
          {value}
        </a>
      )
    case 'reference':
      return field.referenceList ? labelFor(field.referenceList, raw) : humanize(value)
    case 'longtext':
      return <span className="whitespace-pre-wrap">{value}</span>
    default:
      return humanize(value)
  }
}

export function DetailsTab({ entity, org, onAddParcelRecord }: DetailsTabProps) {
  const config = DIRECTORY_CONFIGS[entity.type]
  const { labelFor } = useReferenceLabels()
  const { canSeeNotes, canEdit } = useRole()
  const location = useLocation(entity.id)
  const clearLocation = useSetManualLocation()

  const fields = config.fields.filter((field) => {
    if (field.hiddenFromGrid) return false
    if (field.internal && !canSeeNotes) return false
    return true
  })

  return (
    <div className="flex flex-col gap-4">
      {/* A face is how a board member recognises a resident, so it leads. */}
      {entity.type === 'person' && canEdit ? <PhotoPanel entity={entity} /> : null}
      <Panel>
        <PanelHeader title="Details" />
        <PanelBody>
          <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.key}
                className={cn(
                  'border-rule flex flex-col gap-0.5 border-b pb-2.5 last:border-b-0',
                  field.format === 'longtext' && 'md:col-span-2'
                )}
              >
                <dt className="label-caps text-[0.6875rem]">{field.label}</dt>
                <dd className="text-ink text-sm">
                  {renderValue(field, entity.data[field.key], labelFor)}
                </dd>
              </div>
            ))}
          </dl>
        </PanelBody>
      </Panel>

      {entity.type === 'property' ? (
        <ParcelRecordCard property={entity} org={org} onAddParcelRecord={onAddParcelRecord} />
      ) : null}

      {/*
        Where this record sits on the plat, and where that answer came from. A
        derived location that presents itself as fact is worse than none, so
        the source is always stated.
      */}
      <Panel>
        <PanelHeader
          title="Location"
          action={
            <Link
              to={`/plat/${entity.id}`}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <MapPin className="size-3.5" />
              Show on the plat
            </Link>
          }
        />
        <PanelBody className="flex flex-col gap-2">
          {location.isLoading ? (
            <p className="text-ink-muted text-13">Working out where this is</p>
          ) : (
            <LocationSourceNote
              location={location.data ?? null}
              entity={entity}
              canEdit={false}
            />
          )}

          {location.data?.source === 'manual' && canEdit ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clearLocation.mutate({ entityId: entity.id, point: null })}
              >
                Clear the hand placement
              </Button>
            </div>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  )
}
