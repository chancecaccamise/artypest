import { Link } from 'react-router-dom'
import { Network } from 'lucide-react'

import { recordsAtParcel } from './parcel-summary'
import { entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import type { Entity, LocationIndex } from '@/lib/data/types'
import { ENTITY_TYPE_LABELS } from '@/lib/data/types'
import { readString } from '@/lib/format'
import type { ResolvedGraph } from '@/lib/insights'

interface ParcelConnectionsProps {
  property: Entity | null
  graph: ResolvedGraph
  locations: LocationIndex
}

/** The full-width working area beneath the plat for everything tied to a lot. */
export function ParcelConnections({ property, graph, locations }: ParcelConnectionsProps) {
  const rows = property ? recordsAtParcel(property, graph) : []

  return (
    <Panel>
      <div className="border-rule flex items-center gap-2 border-b px-3 py-2">
        <Network className="text-ink-muted size-4" aria-hidden="true" />
        <h2 className="label-caps">Parcel connections</h2>
        {property ? (
          <span className="text-ink-faint ml-auto truncate font-mono text-xs">{property.name}</span>
        ) : null}
      </div>

      {!property ? (
        <div className="p-4">
          <EmptyState
            title="Select a parcel to see its connections"
            description="Click a parcel or one of its dots to see the people, businesses, and associations tied to it."
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No connections recorded for this parcel"
            description="The parcel data is available, but no person, business, or association has been linked to it yet."
          />
        </div>
      ) : (
        <ul className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id} className="border-rule bg-paper-sunken rounded-[3px] border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  to={entityHref(row.entity.type, row.entity.id)}
                  className="text-ink hover:text-survey min-w-0 flex-1 truncate font-semibold hover:underline"
                >
                  {row.entity.name}
                </Link>
                <TypeBadge type={row.entity.type}>
                  {ENTITY_TYPE_LABELS[row.entity.type].singular}
                </TypeBadge>
              </div>
              <p className="text-ink-muted mt-1 text-xs">{row.label}</p>
              <ConnectionDetails entity={row.entity} />
              {locations.byEntity.has(row.entity.id) ? null : (
                <p className="text-ink-faint mt-1 text-xs">No separate map location</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ConnectionDetails({ entity }: { entity: Entity }) {
  const contactName = entity.type === 'business' ? readString(entity.data.contactName) : ''
  const email = readString(entity.data.email)
  const phone = readString(entity.data.phone)
  const website = entity.type === 'business' ? readString(entity.data.website) : ''
  const address = readString(entity.data.mailingAddress)

  if (!contactName && !email && !phone && !website && !address) return null

  return (
    <div className="text-ink-muted mt-2 flex flex-col gap-1 text-xs">
      {contactName ? <span>Contact: {contactName}</span> : null}
      {email ? (
        <a className="text-survey w-fit hover:underline" href={`mailto:${email}`}>
          {email}
        </a>
      ) : null}
      {phone ? (
        <a className="text-survey w-fit font-mono hover:underline" href={`tel:${phone}`}>
          {phone}
        </a>
      ) : null}
      {website ? (
        <a
          className="text-survey w-fit break-all hover:underline"
          href={website}
          target="_blank"
          rel="noreferrer"
        >
          {website.replace(/^https?:\/\//, '')}
        </a>
      ) : null}
      {address ? <span>{address}</span> : null}
    </div>
  )
}
