import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ClipboardList, MapPinned, Network, Users } from 'lucide-react'

import { entityHref } from '@/components/layout/nav-config'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { PhaseTag } from '@/components/ui/phase-note'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import { AuditLine, groupByDay } from '@/features/directory/HistoryTab'
import { useActivity } from '@/hooks/use-data'
import type { ActivityEntry } from '@/lib/data/types'
import {
  daysUntil,
  formatAuditValue,
  formatDate,
  formatDayHeader,
  formatFieldName,
  formatPercent,
  formatRelativeDays,
  formatTime,
} from '@/lib/format'
import {
  OCCUPANCY_LABELS,
  OCCUPANCY_SEGMENTS,
  computeBoard,
  computeNeedsAttention,
  computeOccupancy,
  computeStats,
  type ResolvedGraph,
} from '@/lib/insights'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------ stat strip -- */

interface StatTile {
  label: string
  value: string
  /** A second line under the figure, for the denominator or a count. */
  detail?: string
}

export function StatStrip({ graph }: { graph: ResolvedGraph | null }) {
  const tiles = useMemo<StatTile[] | null>(() => {
    if (!graph) return null
    const stats = computeStats(graph)

    return [
      { label: 'Lots', value: String(stats.lots) },
      { label: 'Residents', value: String(stats.residents), detail: 'with a current address' },
      {
        label: 'Owner-occupied',
        value: `${stats.ownerOccupiedPercent}%`,
        detail: `${stats.ownerOccupied} of ${stats.lots} lots`,
      },
      { label: 'Active vendors', value: String(stats.activeVendors), detail: 'under contract' },
      {
        label: 'Board seats',
        value: `${stats.boardSeatsFilled} / ${stats.boardSeatsTotal}`,
        detail: 'filled',
      },
      { label: 'Open items', value: String(stats.openItems), detail: 'not closed' },
    ]
  }, [graph])

  return (
    <Panel className="mb-4 overflow-hidden">
      <div className="divide-rule grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {(tiles ?? Array.from({ length: 6 }, () => null)).map((tile, index) => (
          <div key={tile?.label ?? index} className="flex flex-col gap-1 px-4 py-3">
            {tile ? (
              <>
                <span className="font-display text-ink text-2xl leading-none font-bold">
                  {tile.value}
                </span>
                <span className="label-caps">{tile.label}</span>
                {tile.detail ? (
                  <span className="text-ink-faint font-mono text-[0.6875rem]">{tile.detail}</span>
                ) : null}
              </>
            ) : (
              <>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-20" />
              </>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------- needs attention -- */

const VISIBLE_ATTENTION_ITEMS = 12

export function NeedsAttentionPanel({ graph }: { graph: ResolvedGraph | null }) {
  const items = useMemo(() => (graph ? computeNeedsAttention(graph) : null), [graph])

  if (!items) {
    return (
      <Panel>
        <PanelHeader title="Needs attention" />
        <PanelBody>
          <SkeletonRows rows={6} />
        </PanelBody>
      </Panel>
    )
  }

  const visible = items.slice(0, VISIBLE_ATTENTION_ITEMS)
  const overdue = items.filter((item) => item.urgency === 'overdue').length

  return (
    <Panel>
      <PanelHeader
        title="Needs attention"
        meta={items.length === 0 ? undefined : `${items.length}`}
        action={
          overdue > 0 ? (
            <span className="text-oxblood text-xs font-semibold">{overdue} overdue</span>
          ) : null
        }
      />

      <PanelBody className="p-0">
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing needs attention right now." />
          </div>
        ) : (
          <ul className="divide-rule divide-y">
            {visible.map((item) => (
              <li key={item.id}>
                <Link
                  to={entityHref(item.entityType, item.entityId)}
                  className={cn(
                    'hover:bg-paper-sunken flex items-center gap-3 border-l-[3px] px-3 py-2 transition-colors duration-[120ms]',
                    item.urgency === 'overdue'
                      ? 'border-l-oxblood'
                      : item.urgency === 'approaching'
                        ? 'border-l-amber'
                        : 'border-l-transparent'
                  )}
                >
                  <span className="text-ink min-w-0 flex-1 truncate text-13">
                    {item.description}
                  </span>

                  <span className="text-ink-faint hidden shrink-0 font-mono text-[0.6875rem] sm:inline">
                    {item.source}
                  </span>

                  <span
                    title={item.date ? formatRelativeDays(daysUntil(item.date)) : undefined}
                    className={cn(
                      'shrink-0 font-mono text-xs whitespace-nowrap',
                      item.urgency === 'overdue' ? 'text-oxblood' : 'text-ink-muted'
                    )}
                  >
                    {item.date ? formatDate(item.date) : 'no date'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>

      {items.length > VISIBLE_ATTENTION_ITEMS ? (
        <PanelFooter>
          <span>
            {items.length - VISIBLE_ATTENTION_ITEMS} more, mostly records missing an owner or a
            parcel number
          </span>
          <Link to="/properties" className="text-survey hover:underline">
            Open Properties
          </Link>
        </PanelFooter>
      ) : null}
    </Panel>
  )
}

/* ------------------------------------------------------------------ board -- */

export function BoardPanel({ graph }: { graph: ResolvedGraph | null }) {
  const groups = useMemo(() => (graph ? computeBoard(graph) : null), [graph])

  if (!groups) {
    return (
      <Panel>
        <PanelHeader title="Board and committees" />
        <PanelBody>
          <SkeletonRows rows={5} />
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader title="Board and committees" />
      <PanelBody className="flex flex-col gap-4">
        {groups.length === 0 ? (
          <EmptyState
            title="No current board seats on record"
            description="Board membership is a connection, not a separate list. Add a member_of connection with the board role to a person."
          />
        ) : (
          groups.map((group) => (
            <section key={group.associationId}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <Link
                  to={entityHref('association', group.associationId)}
                  className="label-caps hover:text-survey truncate"
                >
                  {group.associationName}
                </Link>
                <span className="text-ink-faint shrink-0 font-mono text-xs">
                  {group.seats.length} / {group.seatCount}
                </span>
              </div>

              <ul className="divide-rule border-rule divide-y border-t">
                {group.seats.map((seat) => {
                  const days = seat.termEnd ? daysUntil(seat.termEnd) : null
                  return (
                    <li key={seat.relationId} className="flex items-center gap-2 py-1.5">
                      <Link
                        to={entityHref('person', seat.personId)}
                        className="text-ink hover:text-survey min-w-0 flex-1 truncate text-13 hover:underline"
                      >
                        {seat.personName}
                      </Link>
                      <span className="text-ink-muted shrink-0 text-xs">{seat.positionLabel}</span>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-xs',
                          days !== null && days <= 90 ? 'text-amber' : 'text-ink-faint'
                        )}
                      >
                        {seat.termEnd ? formatDate(seat.termEnd) : 'no term end'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </PanelBody>
    </Panel>
  )
}

/* --------------------------------------------------------------- activity -- */

export function RecentActivityPanel() {
  const query = useActivity({ pageSize: 20 })
  const days = useMemo(() => groupByDay(query.data?.rows ?? []), [query.data])

  return (
    <Panel>
      <PanelHeader
        title="Recent activity"
        action={
          <Link to="/activity" className="text-survey text-xs hover:underline">
            Full activity
          </Link>
        }
      />
      <PanelBody className="flex flex-col gap-4">
        {query.isLoading ? (
          <SkeletonRows rows={7} />
        ) : days.length === 0 ? (
          <EmptyState
            title="No changes recorded yet"
            description="Every edit, field by field, will appear here as soon as someone makes one."
          />
        ) : (
          days.map((day) => (
            <section key={day.date}>
              <h3 className="label-caps border-rule mb-1 border-b pb-1">
                {formatDayHeader(day.date)}
              </h3>
              <ul className="divide-rule flex flex-col divide-y">
                {day.entries.map((entry) => (
                  <ActivityLine key={entry.id} entry={entry as ActivityEntry} />
                ))}
              </ul>
            </section>
          ))
        )}
      </PanelBody>
    </Panel>
  )
}

/** An audit line with the subject rendered as a link to the record. */
function ActivityLine({ entry }: { entry: ActivityEntry }) {
  if (!entry.entityId || !entry.entityType) return <AuditLine entry={entry} />

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 text-13">
      <span className="text-ink-faint w-16 shrink-0 font-mono text-xs">
        {formatTime(entry.changedAt)}
      </span>
      <span className="text-ink font-medium">{entry.changedBy ?? 'System'}</span>
      <span className="text-ink-muted">
        {entry.action === 'insert' ? 'created' : entry.action === 'delete' ? 'removed' : 'changed'}
      </span>
      <Link
        to={entityHref(entry.entityType, entry.entityId)}
        className="text-survey hover:underline"
      >
        {entry.entityName}
      </Link>
      {entry.action === 'update' && entry.fieldName ? <FieldDiff entry={entry} /> : null}
    </li>
  )
}

function FieldDiff({ entry }: { entry: ActivityEntry }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
      <span className="text-ink-muted">{formatFieldName(entry.fieldName)}</span>
      <span className="text-ink-muted line-through decoration-1">
        {formatAuditValue(entry.oldValue)}
      </span>
      <span className="text-ink-faint" aria-hidden="true">
        &rarr;
      </span>
      <span className="text-ink">{formatAuditValue(entry.newValue)}</span>
    </span>
  )
}

/* -------------------------------------------------------------- occupancy -- */

const SEGMENT_COLOR: Record<(typeof OCCUPANCY_SEGMENTS)[number], string> = {
  owner_occupied: 'var(--moss)',
  long_term_rental: 'var(--survey)',
  short_term_rental: 'var(--amber)',
  vacant_or_unknown: 'var(--rule-strong)',
}

export function OccupancyPanel({ graph }: { graph: ResolvedGraph | null }) {
  const occupancy = useMemo(() => (graph ? computeOccupancy(graph) : null), [graph])

  if (!occupancy) {
    return (
      <Panel>
        <PanelHeader title="Occupancy" />
        <PanelBody>
          <SkeletonRows rows={4} />
        </PanelBody>
      </Panel>
    )
  }

  const { total, counts } = occupancy

  return (
    <Panel>
      <PanelHeader title="Occupancy" meta={`${total} lots`} />
      <PanelBody className="flex flex-col gap-3">
        {total === 0 ? (
          <EmptyState title="No lots on record yet" description="Add a property to see occupancy." />
        ) : (
          <>
            {/* Divs and token colors. A chart library for one stacked bar
                would be four hundred kilobytes for a rectangle. */}
            <div
              className="border-rule flex h-6 w-full overflow-hidden rounded-[3px] border"
              role="img"
              aria-label={OCCUPANCY_SEGMENTS.map(
                (segment) => `${OCCUPANCY_LABELS[segment]}: ${counts[segment]} of ${total}`
              ).join(', ')}
            >
              {OCCUPANCY_SEGMENTS.map((segment) =>
                counts[segment] === 0 ? null : (
                  <div
                    key={segment}
                    style={{
                      width: `${(counts[segment] / total) * 100}%`,
                      backgroundColor: SEGMENT_COLOR[segment],
                    }}
                  />
                )
              )}
            </div>

            <ul className="flex flex-col gap-1.5">
              {OCCUPANCY_SEGMENTS.map((segment) => (
                <li key={segment} className="flex items-center gap-2 text-13">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: SEGMENT_COLOR[segment] }}
                  />
                  <span className="text-ink-muted min-w-0 flex-1 truncate">
                    {OCCUPANCY_LABELS[segment]}
                  </span>
                  <span className="text-ink shrink-0 font-mono text-xs">{counts[segment]}</span>
                  <span className="text-ink-faint w-10 shrink-0 text-right font-mono text-xs">
                    {formatPercent(counts[segment], total)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------- quick add -- */

export interface QuickAddPanelProps {
  onAdd: (type: 'person' | 'property' | 'business' | 'record') => void
  disabled?: boolean
}

export function QuickAddPanel({ onAdd, disabled = false }: QuickAddPanelProps) {
  const actions = [
    { type: 'person' as const, label: 'Add person', icon: Users },
    { type: 'property' as const, label: 'Add property', icon: MapPinned },
    { type: 'business' as const, label: 'Add business', icon: Building2 },
    { type: 'record' as const, label: 'Add record', icon: ClipboardList },
  ]

  return (
    <Panel>
      <PanelHeader title="Quick add" />
      {/* content-start keeps the buttons their own height when this panel is
          stretched to match the Connection Map card beside it. */}
      <PanelBody className="grid auto-rows-min grid-cols-2 content-start gap-2">
        {actions.map((action) => (
          <Button
            key={action.type}
            variant="secondary"
            className="h-16 flex-col gap-1.5"
            disabled={disabled}
            onClick={() => onAdd(action.type)}
          >
            <action.icon className="text-ink-muted size-4" />
            <span className="text-13">{action.label}</span>
          </Button>
        ))}
      </PanelBody>
      {disabled ? (
        <PanelFooter>
          <span>The resident view is read only.</span>
        </PanelFooter>
      ) : null}
    </Panel>
  )
}

/* ------------------------------------------------------------ map preview -- */

export function MapPreviewPanel({ graph }: { graph: ResolvedGraph | null }) {
  const connections = graph?.relations.length ?? 0
  const records = graph?.entities.length ?? 0

  return (
    <Panel>
      <PanelHeader title="Connection Map" action={<PhaseTag>live</PhaseTag>} />
      <PanelBody className="flex flex-col gap-3">
        <p className="text-ink-muted text-13">
          Every resident, lot, business, and association in one picture. Start from any record and
          walk outward: who owns what, who lives where, which vendor a board member happens to work
          for.
        </p>

        <MapPreviewGraphic />

        <div className="flex items-center gap-4">
          <span className="text-ink-faint font-mono text-xs">{records} records</span>
          <span className="text-ink-faint font-mono text-xs">{connections} connections</span>
        </div>
      </PanelBody>

      <PanelFooter>
        <span>Click any node to re-centre the map on it.</span>
        <Link to="/map" className={cn(buttonVariants({ size: 'sm', variant: 'primary' }))}>
          <Network className="size-3.5" />
          Open map
        </Link>
      </PanelFooter>
    </Panel>
  )
}

/** A small, honest sketch of the map's shape. Not a fake graph of real data. */
function MapPreviewGraphic() {
  const nodes = [
    { x: 50, y: 18, color: 'var(--type-person)' },
    { x: 18, y: 58, color: 'var(--type-property)' },
    { x: 50, y: 62, color: 'var(--type-property)' },
    { x: 82, y: 52, color: 'var(--type-business)' },
    { x: 30, y: 88, color: 'var(--type-association)' },
    { x: 72, y: 86, color: 'var(--type-record)' },
  ] as const

  return (
    <svg
      viewBox="0 0 100 100"
      className="border-rule bg-paper h-32 w-full rounded-[3px] border"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {nodes.slice(1).map((node, index) => (
        <line
          key={index}
          x1={nodes[0].x}
          y1={nodes[0].y}
          x2={node.x}
          y2={node.y}
          stroke="var(--rule)"
          strokeWidth="0.7"
        />
      ))}
      <line x1={18} y1={58} x2={30} y2={88} stroke="var(--rule)" strokeWidth="0.7" />
      <line x1={82} y1={52} x2={72} y2={86} stroke="var(--rule)" strokeWidth="0.7" />

      {nodes.map((node, index) => (
        <g key={index}>
          <rect
            x={node.x - 7}
            y={node.y - 4.5}
            width={14}
            height={9}
            rx={1.5}
            fill="var(--paper-raised)"
            stroke={node.color}
            strokeWidth="0.9"
          />
          <rect x={node.x - 4.5} y={node.y - 1.6} width={9} height={1.4} rx={0.7} fill={node.color} />
          <rect
            x={node.x - 4.5}
            y={node.y + 0.6}
            width={6}
            height={1.1}
            rx={0.55}
            fill="var(--rule-strong)"
          />
        </g>
      ))}
    </svg>
  )
}
