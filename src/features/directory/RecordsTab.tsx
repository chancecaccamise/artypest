import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge, type StatusTone } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IdChip } from '@/components/ui/id-chip'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useGraph } from '@/hooks/use-data'
import type { Entity } from '@/lib/data/types'
import { formatDate, humanize, readString } from '@/lib/format'
import { isTodo } from '@/lib/todos'

/*
  Records linked to this entity, newest first.

  A record reaches an entity two ways: through its `propertyId` field, or
  through any relation. Both are collected here so a covenant violation filed
  against a lot shows on the lot, and one referencing a document shows on the
  document.
*/

const STATUS_TONE: Record<string, StatusTone> = {
  open: 'oxblood',
  in_review: 'amber',
  closed: 'moss',
}

export function RecordsTab({ entity }: { entity: Entity }) {
  const { graph, isLoading } = useGraph()

  const records = useMemo(() => {
    if (!graph) return []

    const found = new Map<string, Entity>()

    for (const candidate of graph.entities) {
      if (candidate.type !== 'record') continue
      if (isTodo(candidate)) continue
      if (candidate.deletedAt !== null) continue
      if (candidate.data.propertyId === entity.id) found.set(candidate.id, candidate)
    }

    for (const relation of graph.relationsFor.get(entity.id) ?? []) {
      const otherId =
        relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId
      const other = graph.byId.get(otherId)
      if (other?.type === 'record' && other.deletedAt === null) found.set(other.id, other)
    }

    return [...found.values()].sort((a, b) => {
      const left = readString(a.data.occurredOn) || a.createdAt
      const right = readString(b.data.occurredOn) || b.createdAt
      return right.localeCompare(left)
    })
  }, [graph, entity.id])

  if (isLoading) {
    return (
      <Panel>
        <PanelHeader title="Records" />
        <PanelBody>
          <SkeletonRows rows={4} />
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader title="Records" meta={records.length === 0 ? undefined : `${records.length}`} />
      <PanelBody>
        {records.length === 0 ? (
          <EmptyState
            title="No records are linked to this yet"
            description="Violations, requests, complaints, and minutes filed against this record will be listed here, newest first."
          />
        ) : (
          <ul className="divide-rule border-rule divide-y border-t">
            {records.map((record) => {
              const status = readString(record.data.status)
              const recordNumber = readString(record.data.recordNumber)
              const occurredOn = readString(record.data.occurredOn)

              return (
                <li key={record.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  {recordNumber === '' ? null : <IdChip>{recordNumber}</IdChip>}

                  <Link
                    to={`/records/${record.id}`}
                    className="text-ink hover:text-survey min-w-0 flex-1 text-sm font-medium hover:underline"
                  >
                    {record.name}
                  </Link>

                  {status === '' ? null : (
                    <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>
                      {humanize(status)}
                    </StatusBadge>
                  )}

                  <span className="text-ink-faint font-mono text-xs whitespace-nowrap">
                    {occurredOn === '' ? '' : formatDate(occurredOn)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  )
}
