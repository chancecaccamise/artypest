import { Archive, Mail, Network, Phone, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { entityHref } from '@/components/layout/nav-config'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { ReviewToggle, reviewEdgeStyle } from '@/features/review/ReviewMark'
import { readString } from '@/lib/format'
import { initialsFor } from '@/lib/photos'
import { cn } from '@/lib/utils'
import {
  ENTITY_TYPES,
  type Entity,
  type EntityType,
  type ReviewState,
  type ReviewStatus,
} from '@/lib/data/types'

/*
  A person as a card rather than a table row.

  A table is the right shape for ten thousand parcels and the wrong one for
  fifty residents: a board member recognises a person by their face and by who
  they are connected to, neither of which a row of cells carries. The card leads
  with the photograph, then how to reach them, then what they are connected to.

  The connection counts are the point of the whole card. "Two properties, one
  association" is the question this application exists to answer, and it should
  be legible without opening anything.
*/

/** How many of each kind of record this person is connected to. */
export type ConnectionCounts = Partial<Record<EntityType, number>>

export interface PersonCardProps {
  person: Entity
  counts: ConnectionCounts
  reviewState: ReviewState
  reviewStatus: ReviewStatus | undefined
  onEdit: (person: Entity) => void
  onArchive: (person: Entity) => void
  onDelete: (person: Entity) => void
  className?: string
}

/*
  Shown in the order a board member thinks about them: the lots first, then the
  people, then the organisations, then the paperwork.
*/
const COUNT_ORDER: EntityType[] = [
  'property',
  'person',
  'business',
  'association',
  'record',
  'document',
  'asset',
]

const COUNT_LABELS: Record<EntityType, { one: string; many: string }> = {
  property: { one: 'property', many: 'properties' },
  person: { one: 'person', many: 'people' },
  business: { one: 'business', many: 'businesses' },
  association: { one: 'association', many: 'associations' },
  record: { one: 'record', many: 'records' },
  document: { one: 'document', many: 'documents' },
  asset: { one: 'asset', many: 'assets' },
}

function Avatar({ person }: { person: Entity }) {
  const photo = readString(person.data.photo)

  if (photo !== '') {
    return (
      <img
        src={photo}
        // The name is already beside it, so repeating it would be read twice.
        alt=""
        className="border-rule size-14 shrink-0 rounded-[3px] border object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="border-rule bg-paper-sunken text-ink-muted flex size-14 shrink-0 items-center justify-center rounded-[3px] border font-display text-base"
    >
      {initialsFor(person.name)}
    </span>
  )
}

export function PersonCard({
  person,
  counts,
  reviewState,
  reviewStatus,
  onEdit,
  onArchive,
  onDelete,
  className,
}: PersonCardProps) {
  const email = readString(person.data.email)
  const phone = readString(person.data.phone)
  const bio = readString(person.data.bio)
  const href = entityHref('person', person.id)

  const connected = COUNT_ORDER.filter((type) => (counts[type] ?? 0) > 0)
  const total = ENTITY_TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0)

  return (
    <li
      className={cn(
        'panel flex flex-col',
        person.archivedAt === null ? '' : 'opacity-70',
        className
      )}
      // The same leading rule the table rows carry, so a grid of cards and a
      // list of rows are read the same way.
      style={reviewEdgeStyle(reviewState)}
    >
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex items-start gap-3">
          <Avatar person={person} />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-ink truncate text-base font-bold">
              {/* The whole card is not a link: it holds its own controls. */}
              <Link to={href} className="hover:text-survey focus-visible:text-survey">
                {person.name}
              </Link>
            </h3>

            {email === '' && phone === '' ? (
              <p className="text-ink-faint text-xs">No contact details</p>
            ) : (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {email === '' ? null : (
                  <a
                    href={`mailto:${email}`}
                    className="text-ink-muted hover:text-survey flex items-center gap-1.5 text-xs"
                  >
                    <Mail className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{email}</span>
                  </a>
                )}
                {phone === '' ? null : (
                  <a
                    href={`tel:${phone}`}
                    className="text-ink-muted hover:text-survey flex items-center gap-1.5 font-mono text-xs"
                  >
                    <Phone className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{phone}</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {person.archivedAt === null ? null : (
            <span className="border-rule text-ink-faint rounded-[3px] border px-1.5 py-0.5 text-xs">
              Archived
            </span>
          )}
        </div>

        {bio === '' ? (
          <p className="text-ink-faint text-13 italic">No biography</p>
        ) : (
          // Three lines, so a long biography does not make one card twice the
          // height of the ones beside it.
          <p className="text-ink-muted line-clamp-3 text-13">{bio}</p>
        )}

        <div className="mt-auto">
          {total === 0 ? (
            <p className="text-ink-faint text-xs">Not connected to anything yet</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {connected.map((type) => {
                const count = counts[type] ?? 0
                const label = count === 1 ? COUNT_LABELS[type].one : COUNT_LABELS[type].many
                return (
                  <li
                    key={type}
                    className="border-rule text-ink-muted rounded-full border px-2 py-0.5 text-xs"
                  >
                    <span className="text-ink font-mono">{count}</span> {label}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-rule flex items-center gap-1 border-t px-2 py-1.5">
        <ReviewToggle
          entityId={person.id}
          state={reviewState}
          status={reviewStatus}
          compact
          className="mr-1 py-1"
        />

        <Tooltip label="Open this person">
          <Link
            to={href}
            aria-label={`Open ${person.name}`}
            className="text-ink-muted hover:text-ink hover:bg-paper-sunken rounded-[3px] p-1.5"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        </Tooltip>

        <Tooltip label="Show on the Connection Map">
          <Link
            to={`/map/${person.id}`}
            aria-label={`Show ${person.name} on the Connection Map`}
            className="text-ink-muted hover:text-ink hover:bg-paper-sunken rounded-[3px] p-1.5"
          >
            <Network className="size-4" aria-hidden="true" />
          </Link>
        </Tooltip>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Edit ${person.name}`}
            onClick={() => onEdit(person)}
          >
            Edit
          </Button>
          <Tooltip label={person.archivedAt === null ? 'Archive' : 'Restore'}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${person.archivedAt === null ? 'Archive' : 'Restore'} ${person.name}`}
              onClick={() => onArchive(person)}
            >
              <Archive className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
          <Tooltip label="Delete">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${person.name}`}
              onClick={() => onDelete(person)}
              className="text-oxblood"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </li>
  )
}
