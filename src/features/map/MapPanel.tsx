import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crosshair, Mail, Network, X } from 'lucide-react'

import { NotifyDialog } from './NotifyDialog'
import { adjacentPins } from './spatial'
import { entityHref } from '@/components/layout/nav-config'
import { StatusBadge, TypeBadge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IdChip } from '@/components/ui/id-chip'
import { LocationSourceNote } from './LocationSourceNote'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import { ENTITY_TYPE_LABELS, type Entity, type LocationIndex } from '@/lib/data/types'
import { formatAcreage, formatCurrency, readNumber, readString } from '@/lib/format'
import { isCurrent, relationKey, type ResolvedGraph } from '@/lib/insights'
import { cn } from '@/lib/utils'

/*
  The selection side panel. Renderer independent: it is given a record and an
  index, and knows nothing about how the plat drew it.
*/

export interface MapPanelProps {
  entity: Entity | null
  graph: ResolvedGraph
  locations: LocationIndex
  onClose: () => void
  onPlace: (entity: Entity) => void
  onFocusConnections: (entityId: string) => void
  canEdit: boolean
}

export function MapPanel({
  entity,
  graph,
  locations,
  onClose,
  onPlace,
  onFocusConnections,
  canEdit,
}: MapPanelProps) {
  const [notifyOpen, setNotifyOpen] = useState(false)
  const { labelFor } = useReferenceLabels()

  const location = entity ? (locations.byEntity.get(entity.id) ?? null) : null
  const pin = entity ? readString(entity.data.pin) : ''

  const neighbours = useMemo(
    () => (entity?.type === 'property' && pin ? adjacentPins(pin) : []),
    [entity?.type, pin]
  )

  const connections = useMemo(() => {
    if (!entity) return []
    const rows: { id: string; label: string; other: Entity; current: boolean }[] = []

    for (const relation of graph.relationsFor.get(entity.id) ?? []) {
      const type = graph.typeById.get(relation.relationTypeId)
      if (!type) continue
      const outgoing = relation.fromEntityId === entity.id
      const other = graph.byId.get(outgoing ? relation.toEntityId : relation.fromEntityId)
      if (!other) continue
      rows.push({
        id: relation.id,
        label: outgoing ? type.label : type.reverseLabel,
        other,
        current: isCurrent(relation),
      })
    }

    return rows
      .sort((a, b) => Number(b.current) - Number(a.current) || a.other.name.localeCompare(b.other.name))
      .slice(0, 8)
  }, [entity, graph])

  const openItems = useMemo(() => {
    if (!entity || entity.type !== 'property') return 0
    return graph.entities.filter(
      (candidate) =>
        candidate.type === 'record' &&
        candidate.deletedAt === null &&
        candidate.data.propertyId === entity.id &&
        candidate.data.status !== 'closed'
    ).length
  }, [entity, graph])

  if (!entity) {
    return (
      <div className="p-4">
        <EmptyState
          title="Nothing selected"
          description="Click a lot on the plat, or pick a record from the unplaced list, to see what is on it."
        />
      </div>
    )
  }

  const acreage = readNumber(entity.data.acreage)
  const assessed = readNumber(entity.data.assessedValue)

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-rule flex items-start justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={entity.type}>{ENTITY_TYPE_LABELS[entity.type].singular}</TypeBadge>
            {pin ? <IdChip prefix="PIN">{pin}</IdChip> : null}
          </div>
          <h2 className="font-display text-ink mt-1 text-base leading-tight font-bold">
            {entity.name}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Clear selection">
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <LocationSourceNote location={location} entity={entity} onPlace={onPlace} canEdit={canEdit} />

        {entity.type === 'property' ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Zoning">{readString(entity.data.zoning) || 'Not set'}</Field>
            <Field label="Property use">
              {entity.data.propertyUse ? (
                <span className="font-sans">
                  {labelFor('property_use', entity.data.propertyUse)}
                </span>
              ) : (
                'Not set'
              )}
            </Field>
            <Field label="Acreage">{acreage === null ? 'Not set' : formatAcreage(acreage)}</Field>
            <Field label="Assessed">
              {assessed === null ? 'Not set' : formatCurrency(assessed)}
            </Field>
            <Field label="Adjacent lots">{neighbours.length}</Field>
            <Field label="Open items">
              {openItems === 0 ? (
                'None'
              ) : (
                <span className="text-oxblood font-semibold">{openItems}</span>
              )}
            </Field>
          </dl>
        ) : null}

        {connections.length > 0 ? (
          <section>
            <p className="label-caps mb-1 text-[0.6875rem]">Connections</p>
            <ul className="divide-rule border-rule divide-y border-t">
              {connections.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-center gap-2 py-1.5 text-13',
                    !row.current && 'opacity-60'
                  )}
                >
                  <span className="text-ink-muted w-24 shrink-0 truncate text-xs">{row.label}</span>
                  <Link
                    to={entityHref(row.other.type, row.other.id)}
                    className="text-ink hover:text-survey min-w-0 flex-1 truncate hover:underline"
                  >
                    {row.other.name}
                  </Link>
                  {locations.byEntity.has(row.other.id) ? null : (
                    <StatusBadge tone="neutral">off map</StatusBadge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="border-rule flex flex-wrap gap-2 border-t px-3 py-2.5">
        <Link
          to={entityHref(entity.type, entity.id)}
          className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }))}
        >
          Open record
        </Link>

        <Button size="sm" onClick={() => onFocusConnections(entity.id)}>
          <Network className="size-3.5" />
          Centre the map
        </Button>

        {entity.type === 'property' && pin ? (
          <Button size="sm" variant="primary" onClick={() => setNotifyOpen(true)}>
            <Mail className="size-3.5" />
            Notify adjacent owners
          </Button>
        ) : null}

        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => onPlace(entity)}>
            <Crosshair className="size-3.5" />
            {location?.source === 'manual' ? 'Move pin' : 'Set location'}
          </Button>
        ) : null}
      </div>

      {entity.type === 'property' && pin ? (
        <NotifyDialog
          open={notifyOpen}
          onClose={() => setNotifyOpen(false)}
          subject={entity}
          subjectPin={pin}
          graph={graph}
          locations={locations}
        />
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-caps text-[0.6875rem]">{label}</dt>
      <dd className="text-ink truncate font-mono text-13">{children}</dd>
    </div>
  )
}

/** Relation keys, re-exported for the arc filter so it names the same set. */
export { relationKey }
