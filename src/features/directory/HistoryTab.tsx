import { useMemo } from 'react'

import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useAuditEntries } from '@/hooks/use-data'
import type { AuditEntry, Entity } from '@/lib/data/types'
import { formatAuditValue, formatDayHeader, formatFieldName, formatTime } from '@/lib/format'

/*
  The audit trail for one record. Required, fully working, not a stub.

  Updates arrive as one row per changed field, which is what lets this read as
  a field-level diff rather than a list of "record updated". In Postgres these
  rows come from triggers, never from application code, so the shape here is
  the shape that will land.
*/

export function HistoryTab({ entity }: { entity: Entity }) {
  const query = useAuditEntries(entity.id)

  const days = useMemo(() => groupByDay(query.data ?? []), [query.data])

  if (query.isLoading) {
    return (
      <Panel>
        <PanelHeader title="History" />
        <PanelBody>
          <SkeletonRows rows={6} />
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelHeader title="History" meta={`${query.data?.length ?? 0} entries`} />
      <PanelBody className="flex flex-col gap-5">
        {days.length === 0 ? (
          <EmptyState
            title="No recorded changes yet"
            description="Every edit to this record, field by field, will appear here."
          />
        ) : (
          days.map((day) => (
            <section key={day.date}>
              <h3 className="label-caps border-rule mb-1 border-b pb-1">
                {formatDayHeader(day.date)}
              </h3>
              <ul className="divide-rule flex flex-col divide-y">
                {day.entries.map((entry) => (
                  <AuditLine key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))
        )}
      </PanelBody>
    </Panel>
  )
}

export function groupByDay(entries: AuditEntry[]): { date: string; entries: AuditEntry[] }[] {
  const days = new Map<string, AuditEntry[]>()

  for (const entry of entries) {
    const date = entry.changedAt.slice(0, 10)
    const list = days.get(date)
    if (list) list.push(entry)
    else days.set(date, [entry])
  }

  return [...days.entries()]
    .map(([date, list]) => ({
      date,
      entries: list.sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

const ACTION_VERB: Record<AuditEntry['action'], string> = {
  insert: 'created',
  update: 'changed',
  delete: 'removed',
}

export function AuditLine({ entry }: { entry: AuditEntry }) {
  const isUpdate = entry.action === 'update' && entry.fieldName !== null

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-13">
      <span className="text-ink-faint w-16 shrink-0 font-mono text-xs">
        {formatTime(entry.changedAt)}
      </span>

      <span className="text-ink font-medium">{entry.changedBy ?? 'System'}</span>
      <span className="text-ink-muted">{ACTION_VERB[entry.action]}</span>

      {isUpdate ? (
        <>
          <span className="text-ink font-medium">{formatFieldName(entry.fieldName)}</span>
          <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <span className="text-ink-muted line-through decoration-1">
              {formatAuditValue(entry.oldValue)}
            </span>
            <span className="text-ink-faint" aria-hidden="true">
              &rarr;
            </span>
            <span className="text-ink">{formatAuditValue(entry.newValue)}</span>
          </span>
        </>
      ) : (
        <span className="text-ink-muted">
          {entry.tableName === 'relations' ? 'a connection' : 'this record'}
        </span>
      )}
    </li>
  )
}
