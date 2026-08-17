import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Network, Plus } from 'lucide-react'

import { entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Unavailable } from '@/components/ui/phase-note'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useGraph } from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS, type Entity } from '@/lib/data/types'
import { formatDate, readString } from '@/lib/format'
import { isCurrent } from '@/lib/insights'
import { cn } from '@/lib/utils'

/*
  Connections for one record, grouped by relation type.

  Bidirectionality is a read concern: one stored row is rendered from whichever
  end the reader is standing on, using `label` going out and `reverseLabel`
  coming back. Current relations sit above the divider, historical ones below
  at 60% opacity, because "who owns this now" and "who owned it in 2011" are
  different questions and the first one is asked more often.
*/

interface ConnectionRow {
  relationId: string
  /** The label as read from this entity's end. */
  directionLabel: string
  other: Entity
  startDate: string | null
  endDate: string | null
  attributes: Record<string, unknown>
  current: boolean
}

const HIDDEN_ATTRIBUTE_KEYS = new Set(['role'])

function formatAttributes(attributes: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attributes)) {
    if (HIDDEN_ATTRIBUTE_KEYS.has(key)) continue
    const text = readString(value)
    if (text === '') continue
    parts.push(text)
  }
  return parts.join(' · ')
}

export function ConnectionsTab({ entity }: { entity: Entity }) {
  const { graph, isLoading } = useGraph()

  const groups = useMemo(() => {
    if (!graph) return []

    const touching = graph.relationsFor.get(entity.id) ?? []
    const byType = new Map<string, { label: string; rows: ConnectionRow[] }>()

    for (const relation of touching) {
      const type = graph.typeById.get(relation.relationTypeId)
      if (!type) continue

      const outgoing = relation.fromEntityId === entity.id
      const otherId = outgoing ? relation.toEntityId : relation.fromEntityId
      const other = graph.byId.get(otherId)
      if (!other) continue

      const directionLabel = outgoing ? type.label : type.reverseLabel
      const groupKey = `${type.id}:${outgoing ? 'out' : 'in'}`

      const group = byType.get(groupKey) ?? { label: directionLabel, rows: [] }
      group.rows.push({
        relationId: relation.id,
        directionLabel,
        other,
        startDate: relation.startDate,
        endDate: relation.endDate,
        attributes: relation.attributes,
        current: isCurrent(relation),
      })
      byType.set(groupKey, group)
    }

    for (const group of byType.values()) {
      group.rows.sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1
        return a.other.name.localeCompare(b.other.name)
      })
    }

    return [...byType.entries()]
      .map(([key, group]) => ({ key, ...group }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label))
  }, [graph, entity.id])

  if (isLoading) {
    return (
      <Panel>
        <PanelHeader title="Connections" />
        <PanelBody>
          <SkeletonRows rows={5} />
        </PanelBody>
      </Panel>
    )
  }

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0)

  return (
    <Panel>
      <PanelHeader
        title="Connections"
        meta={total === 0 ? undefined : `${total}`}
        action={
          <>
            <Link to={`/map/${entity.id}`} className={cn(buttonVariants({ size: 'sm' }))}>
              <Network className="size-3.5" />
              Open in map
            </Link>
            <Unavailable reason="Editing connections arrives in Phase 2.">
              <Button size="sm" disabled aria-disabled="true">
                <Plus />
                Add connection
              </Button>
            </Unavailable>
          </>
        }
      />

      <PanelBody className="flex flex-col gap-5">
        {total === 0 ? (
          <EmptyState
            title="Nothing is connected to this record yet"
            description="Connections are what make the map worth opening. Ownership, residency, board seats, and vendor contracts all live here."
          />
        ) : (
          groups.map((group) => {
            const current = group.rows.filter((row) => row.current)
            const historical = group.rows.filter((row) => !row.current)

            return (
              <section key={group.key}>
                <h3 className="label-caps mb-1.5">{group.label}</h3>
                <ul className="divide-rule border-rule divide-y border-t">
                  {current.map((row) => (
                    <ConnectionLine key={row.relationId} row={row} />
                  ))}

                  {historical.length > 0 ? (
                    <li className="text-ink-faint py-1.5 text-[0.6875rem] tracking-[0.06em] uppercase">
                      No longer current
                    </li>
                  ) : null}

                  {historical.map((row) => (
                    <ConnectionLine key={row.relationId} row={row} historical />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </PanelBody>
    </Panel>
  )
}

function ConnectionLine({ row, historical = false }: { row: ConnectionRow; historical?: boolean }) {
  const attributes = formatAttributes(row.attributes)
  const dates = [row.startDate, row.endDate].some(Boolean)
    ? `${row.startDate ? formatDate(row.startDate) : 'unknown'} to ${row.endDate ? formatDate(row.endDate) : 'present'}`
    : null

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2', historical && 'opacity-60')}>
      <TypeBadge type={row.other.type}>{ENTITY_TYPE_LABELS[row.other.type].singular}</TypeBadge>

      <Link
        to={entityHref(row.other.type, row.other.id)}
        className="text-ink hover:text-survey text-sm font-medium hover:underline"
      >
        {row.other.name}
      </Link>

      {attributes ? <span className="text-ink-muted text-xs">{attributes}</span> : null}

      {dates ? (
        <span className="text-ink-faint ml-auto font-mono text-xs whitespace-nowrap">{dates}</span>
      ) : null}
    </li>
  )
}
