import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { entityHref } from '@/components/layout/nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Input, Select } from '@/components/ui/field'
import { Panel, PanelBody } from '@/components/ui/panel'
import { SkeletonRows } from '@/components/ui/skeleton'
import { groupByDay } from '@/features/directory/HistoryTab'
import { useActivity, useActors } from '@/hooks/use-data'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type ActivityEntry,
  type AuditAction,
  type EntityType,
} from '@/lib/data/types'
import { formatAuditValue, formatDayHeader, formatFieldName, formatTime } from '@/lib/format'

const PAGE_SIZE = 100

const ACTIONS: { value: AuditAction; label: string }[] = [
  { value: 'insert', label: 'Created' },
  { value: 'update', label: 'Changed' },
  { value: 'delete', label: 'Removed' },
]

/*
  The global audit feed. Same rendering as the dashboard widget, full page,
  with filters for entity type, action, actor, and an inclusive date range.

  Filter state is in the query string, so "everything Daniel changed in March"
  is a link that can be pasted into an email.
*/
export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const actors = useActors()

  const page = Number(params.get('page') ?? '1')
  const entityType = params.get('type') ?? ''
  const action = params.get('action') ?? ''
  const actor = params.get('actor') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const batchId = params.get('batch') ?? ''

  const query = useActivity({
    page,
    pageSize: PAGE_SIZE,
    entityType: (entityType || undefined) as EntityType | undefined,
    action: (action || undefined) as AuditAction | undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
    batchId: batchId || undefined,
  })

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params)
      if (value === '') next.delete(key)
      else next.set(key, value)
      if (key !== 'page') next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams]
  )

  const days = useMemo(() => groupByDay(query.data?.rows ?? []), [query.data])
  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(entityType || action || actor || from || to || batchId)

  return (
    <>
      <PageHeader
        title="Activity"
        meta={
          query.isLoading ? null : (
            <span className="text-ink-faint font-mono text-sm">{total}</span>
          )
        }
        subtitle="Every change to every record, field by field, newest first."
        actions={
          hasFilters ? (
            <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </Button>
          ) : null
        }
      />

      {batchId ? (
        <Panel className="mb-4">
          <PanelBody className="py-2.5">
            <p className="text-13">
              Showing one import batch,{' '}
              <span className="font-mono text-xs">{batchId}</span>. Clear the filters to see the
              full feed.
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <div className="border-rule flex flex-wrap items-end gap-3 border-b p-3">
          <Field label="Record type" className="w-[10.5rem]">
            <Select value={entityType} onChange={(event) => setParam('type', event.target.value)}>
              <option value="">All types</option>
              {ENTITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ENTITY_TYPE_LABELS[value].plural}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Action" className="w-[9.5rem]">
            <Select value={action} onChange={(event) => setParam('action', event.target.value)}>
              <option value="">All actions</option>
              {ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Changed by" className="w-[12.5rem]">
            <Select value={actor} onChange={(event) => setParam('actor', event.target.value)}>
              <option value="">Anyone</option>
              {(actors.data ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="From" className="w-[10rem]">
            <Input type="date" value={from} onChange={(event) => setParam('from', event.target.value)} />
          </Field>

          <Field label="To" className="w-[10rem]">
            <Input type="date" value={to} onChange={(event) => setParam('to', event.target.value)} />
          </Field>
        </div>

        <PanelBody className="flex flex-col gap-5">
          {query.isLoading ? (
            <SkeletonRows rows={12} />
          ) : days.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No changes match these filters' : 'No changes recorded yet'}
              description={
                hasFilters
                  ? 'Widen the date range or clear a filter.'
                  : 'The feed fills in as soon as someone edits a record.'
              }
              action={
                hasFilters ? (
                  <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            days.map((day) => (
              <section key={day.date}>
                <h2 className="label-caps border-rule mb-1 border-b pb-1">
                  {formatDayHeader(day.date)}
                </h2>
                <ul className="divide-rule flex flex-col divide-y">
                  {day.entries.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry as ActivityEntry} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </PanelBody>

        {days.length > 0 ? (
          <div className="border-rule flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-ink-muted font-mono text-xs">
              {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                Previous
              </Button>
              <span className="text-ink-muted font-mono text-xs">
                {page} / {pageCount}
              </span>
              <Button
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
    </>
  )
}

const ACTION_VERB: Record<AuditAction, string> = {
  insert: 'created',
  update: 'changed',
  delete: 'removed',
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const isUpdate = entry.action === 'update' && entry.fieldName !== null

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-13">
      <span className="text-ink-faint w-16 shrink-0 font-mono text-xs">
        {formatTime(entry.changedAt)}
      </span>

      <span className="text-ink font-medium">{entry.changedBy ?? 'System'}</span>
      <span className="text-ink-muted">{ACTION_VERB[entry.action]}</span>

      {entry.entityType ? (
        <TypeBadge type={entry.entityType}>{ENTITY_TYPE_LABELS[entry.entityType].singular}</TypeBadge>
      ) : null}

      {entry.entityId && entry.entityType ? (
        <Link to={entityHref(entry.entityType, entry.entityId)} className="text-survey hover:underline">
          {entry.entityName}
        </Link>
      ) : (
        <span className="text-ink-muted">a record that has since been removed</span>
      )}

      {isUpdate ? (
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
      ) : null}

      {entry.tableName === 'relations' ? (
        <span className="text-ink-faint text-xs">connection</span>
      ) : null}
    </li>
  )
}
