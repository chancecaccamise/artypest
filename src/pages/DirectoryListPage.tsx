import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { TypeBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Checkbox, Field, Input, Select } from '@/components/ui/field'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import { EntityFormDialog } from '@/features/directory/EntityFormDialog'
import { PersonGrid } from '@/features/directory/PersonGrid'
import { DIRECTORY_CONFIGS } from '@/features/directory/config'
import { ReviewMark, ReviewToggle, reviewEdgeStyle } from '@/features/review/ReviewMark'
import { useEntities, useReviewIndex } from '@/hooks/use-data'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import {
  ENTITY_TYPE_LABELS,
  type EntityType,
  type ReviewState,
} from '@/lib/data/types'
import { REVIEW_FILTER_LABELS, stateFor } from '@/lib/review/status'
import { useRole } from '@/lib/role'

/** The order the work queue is worked in: what is left, then what went stale. */
const REVIEW_FILTERS: ReviewState[] = ['unchecked', 'recheck', 'checked']

const PAGE_SIZE = 50

/*
  One list page for all seven entity types. Columns, filters, and identifier
  chips come from src/features/directory/config.tsx.

  Filter state lives in the query string so a filtered view is a link the
  property manager can send to a board member.
*/
interface PagerProps {
  page: number
  total: number
  pageCount: number
  onPage: (page: number) => void
}

/** Shared by the table and the card grid, so the two cannot drift apart. */
function PagerControls({ page, total, pageCount, onPage }: PagerProps) {
  return (
    <div className="border-rule flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p className="text-ink-muted font-mono text-xs">
        {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="text-ink-muted font-mono text-xs">
          {page} / {pageCount}
        </span>
        <Button size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

export function DirectoryListPage({ type }: { type: EntityType }) {
  const config = DIRECTORY_CONFIGS[type]
  const navigate = useNavigate()
  const { canEdit } = useRole()
  const { labelFor, optionsFor } = useReferenceLabels()
  const reviewIndex = useReviewIndex()

  const [params, setParams] = useSearchParams()
  const [addOpen, setAddOpen] = useState(false)

  const page = Number(params.get('page') ?? '1')
  const search = params.get('q') ?? ''
  const showArchived = params.get('archived') === '1'
  const review = (params.get('review') ?? '') as ReviewState | ''
  const sortBy = (params.get('sort') ?? 'name') as 'name' | 'createdAt' | 'updatedAt'
  const sortDir = (params.get('dir') ?? 'asc') as 'asc' | 'desc'

  const dataFilters = useMemo(() => {
    const filters: Record<string, string> = {}
    for (const filter of config.filters) {
      const value = params.get(filter.key)
      if (value) filters[filter.key] = value
    }
    return filters
  }, [config.filters, params])

  const query = useEntities({
    type,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
    include: showArchived ? 'all' : 'active',
    sortBy,
    sortDir,
    dataFilters,
    review: review === '' ? undefined : review,
  })

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params)
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
      // Any change to what is being listed puts the reader back on page one.
      if (key !== 'page') next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams]
  )

  const toggleSort = (key: 'name' | 'createdAt' | 'updatedAt') => {
    const next = new URLSearchParams(params)
    if (sortBy === key) {
      next.set('dir', sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      next.set('sort', key)
      next.set('dir', 'asc')
    }
    next.delete('page')
    setParams(next, { replace: true })
  }

  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const activeFilterCount =
    Object.keys(dataFilters).length + (search ? 1 : 0) + (showArchived ? 1 : 0) + (review ? 1 : 0)

  const clearFilters = () => setParams(new URLSearchParams(), { replace: true })

  return (
    <>
      <PageHeader
        title={config.title}
        meta={
          query.isLoading ? null : (
            <span className="text-ink-faint font-mono text-sm">{total}</span>
          )
        }
        subtitle={config.blurb}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus />
              Add {config.singular.toLowerCase()}
            </Button>
          ) : null
        }
      />

      <Panel>
        {/* Filter bar */}
        <div className="border-rule flex flex-wrap items-end gap-3 border-b p-3">
          <Field label="Filter text" hideLabel className="min-w-[12rem] flex-1">
            <div className="relative">
              <Search
                className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setParam('q', event.target.value)}
                placeholder={`Filter ${config.title.toLowerCase()}`}
                className="pl-8"
              />
            </div>
          </Field>

          {config.filters.map((filter) => {
            const options = filter.referenceList
              ? optionsFor(filter.referenceList).map((item) => ({
                  value: item.value,
                  label: item.label,
                }))
              : (filter.options ?? [])

            return (
              <Field key={filter.key} label={filter.label} className="w-[11.5rem]">
                <Select
                  value={params.get(filter.key) ?? ''}
                  onChange={(event) => setParam(filter.key, event.target.value)}
                >
                  <option value="">All</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          })}

          {/*
            The control that turns a directory into a work queue. Filter to
            "not checked yet", work down the list, and watch it get shorter.
          */}
          <Field label="Checked" className="w-[11.5rem]">
            <Select value={review} onChange={(event) => setParam('review', event.target.value)}>
              <option value="">All records</option>
              {REVIEW_FILTERS.map((state) => (
                <option key={state} value={state}>
                  {REVIEW_FILTER_LABELS[state]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex h-9 items-center gap-3">
            <Checkbox
              label="Include archived"
              checked={showArchived}
              onChange={(event) => setParam('archived', event.target.checked ? '1' : null)}
            />
            {activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                review === 'unchecked' && activeFilterCount === 1
                  ? `Every one of the ${config.title.toLowerCase()} has been checked`
                  : activeFilterCount > 0
                    ? `No ${config.title.toLowerCase()} match these filters`
                    : `No ${config.title.toLowerCase()} yet`
              }
              description={
                review === 'unchecked' && activeFilterCount === 1
                  ? 'Nothing is left in this queue. Clear the filter to see them all.'
                  : activeFilterCount > 0
                    ? 'Clear the filters to see the full list.'
                    : `Add the first ${config.singular.toLowerCase()} to start building the directory.`
              }
              action={
                activeFilterCount > 0 ? (
                  <Button onClick={clearFilters}>Clear filters</Button>
                ) : canEdit ? (
                  <Button variant="primary" onClick={() => setAddOpen(true)}>
                    <Plus />
                    Add {config.singular.toLowerCase()}
                  </Button>
                ) : null
              }
            />
          </div>
        ) : type === 'person' ? (
          /*
            People are cards rather than rows. Everything around them, the
            filter bar, the search, the archived toggle, and the pager, is the
            same: only the middle changes.
          */
          <>
            <PersonGrid people={rows} />
            <PagerControls
              page={page}
              total={total}
              pageCount={pageCount}
              onPage={(next) => setParam('page', String(next))}
            />
          </>
        ) : (
          <>
            {/* Table on a laptop. Stacked cards below sm, so 375px works. */}
            <TableWrap className="hidden sm:block">
              <Table>
                <Thead>
                  <tr>
                    {config.columns.map((column) => (
                      <Th key={column.key} className={column.className}>
                        {column.sortKey ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.sortKey!)}
                            className="hover:text-ink inline-flex items-center gap-1 uppercase"
                            aria-label={`Sort by ${column.label}`}
                          >
                            {column.label}
                            {sortBy === column.sortKey ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="size-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="size-3" aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        ) : (
                          column.label
                        )}
                      </Th>
                    ))}
                    <Th className="w-28">Checked</Th>
                    <Th className="w-24">Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {rows.map((entity) => {
                    const state = stateFor(reviewIndex.data, entity.id)
                    return (
                    <Tr
                      key={entity.id}
                      onClick={() => navigate(`${config.path}/${entity.id}`)}
                      className="hover:bg-paper-sunken cursor-pointer"
                    >
                      {config.columns.map((column, index) => (
                        <Td
                          key={column.key}
                          className={column.className}
                          /*
                            The gutter. Carried by the first cell so a column of
                            them reads as one rule down the side of the table,
                            and so checking a record moves nothing.
                          */
                          style={index === 0 ? reviewEdgeStyle(state) : undefined}
                        >
                          {index === 0 ? (
                            <Link
                              to={`${config.path}/${entity.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="hover:text-survey hover:underline"
                            >
                              {column.render(entity, labelFor)}
                            </Link>
                          ) : (
                            column.render(entity, labelFor)
                          )}
                        </Td>
                      ))}
                      <Td>
                        <ReviewToggle
                          entityId={entity.id}
                          state={state}
                          status={reviewIndex.data?.byEntity.get(entity.id)}
                          stopPropagation
                        />
                      </Td>
                      <Td>
                        {entity.archivedAt ? (
                          <span className="text-amber text-xs font-semibold">Archived</span>
                        ) : (
                          <span className="text-ink-faint text-xs">Active</span>
                        )}
                      </Td>
                    </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </TableWrap>

            <ul className="divide-rule flex flex-col divide-y sm:hidden">
              {rows.map((entity) => (
                <li key={entity.id} style={reviewEdgeStyle(stateFor(reviewIndex.data, entity.id))}>
                  <Link
                    to={`${config.path}/${entity.id}`}
                    className="hover:bg-paper-sunken flex flex-col gap-1.5 p-3 transition-colors duration-[120ms]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-ink text-sm font-semibold">{entity.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <ReviewMark
                          state={stateFor(reviewIndex.data, entity.id)}
                          status={reviewIndex.data?.byEntity.get(entity.id)}
                          compact
                        />
                        <TypeBadge type={entity.type}>
                          {ENTITY_TYPE_LABELS[entity.type].singular}
                        </TypeBadge>
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {config.columns.slice(1).map((column) => (
                        <div key={column.key} className="min-w-0">
                          <dt className="text-ink-faint text-[0.6875rem] tracking-[0.06em] uppercase">
                            {column.label}
                          </dt>
                          <dd className="text-ink-muted truncate">
                            {column.render(entity, labelFor)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>

            <PagerControls
              page={page}
              total={total}
              pageCount={pageCount}
              onPage={(next) => setParam('page', String(next))}
            />
          </>
        )}
      </Panel>

      <EntityFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        type={type}
        onCreated={(entity) => navigate(`${config.path}/${entity.id}`)}
      />
    </>
  )
}
