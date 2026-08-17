import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { entityHref } from '@/components/layout/nav-config'
import { ConnectionMap, TypeFilterBar, buildRings } from '@/components/graph/ConnectionMap'
import { TypeBadge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Input } from '@/components/ui/field'
import { Panel, PanelBody, PanelFooter } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useGraph } from '@/hooks/use-data'
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@/lib/data/types'
import { cn } from '@/lib/utils'

/*
  The Connection Map page.

  The focus record is in the route, so a map view is a link. Clicking a card
  re-centres the map on it and pushes a history entry, which makes the browser
  back button the undo for exploring.
*/
export function ConnectionMapPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { graph, isLoading } = useGraph()

  const [hiddenTypes, setHiddenTypes] = useState<Set<EntityType>>(new Set())
  const [search, setSearch] = useState('')

  /** With no record in the route, start at the association: everything hangs off it. */
  const focus = useMemo<Entity | null>(() => {
    if (!graph) return null
    if (id) return graph.byId.get(id) ?? null

    const association = graph.entities.find(
      (entity) => entity.type === 'association' && entity.data.associationType === 'hoa'
    )
    return association ?? graph.entities[0] ?? null
  }, [graph, id])

  const rings = useMemo(() => {
    if (!graph || !focus) return null
    return buildRings(graph, focus, hiddenTypes)
  }, [graph, focus, hiddenTypes])

  /** Counts are of everything connected, before the type filters are applied. */
  const counts = useMemo(() => {
    const empty = Object.fromEntries(ENTITY_TYPES.map((type) => [type, 0])) as Record<
      EntityType,
      number
    >
    if (!graph || !focus) return empty

    const all = buildRings(graph, focus, new Set())
    for (const node of [...all.firstRing, ...all.secondRing]) {
      empty[node.entity.type] += 1
    }
    return empty
  }, [graph, focus])

  const searchResults = useMemo(() => {
    if (!graph || search.trim() === '') return []
    const needle = search.trim().toLowerCase()
    return graph.entities
      .filter(
        (entity) =>
          entity.deletedAt === null && entity.name.toLowerCase().includes(needle)
      )
      .slice(0, 8)
  }, [graph, search])

  const toggleType = useCallback((type: EntityType) => {
    setHiddenTypes((previous) => {
      const next = new Set(previous)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  if (isLoading || !graph) {
    return (
      <>
        <PageHeader title="Connection Map" subtitle="Loading the records" />
        <Panel>
          <PanelBody>
            <Skeleton className="h-96 w-full" />
          </PanelBody>
        </Panel>
      </>
    )
  }

  if (!focus) {
    return (
      <>
        <PageHeader title="Connection Map" />
        <Panel>
          <PanelBody>
            <EmptyState
              title="There is nothing to map yet"
              description="Add a property or a person, then connect them. The map draws itself from the connections you record."
              action={
                <Link to="/properties" className={cn(buttonVariants({ variant: 'primary' }))}>
                  Go to Properties
                </Link>
              }
            />
          </PanelBody>
        </Panel>
      </>
    )
  }

  const visibleCount = (rings?.firstRing.length ?? 0) + (rings?.secondRing.length ?? 0)
  const directCount = rings?.firstRing.length ?? 0

  return (
    <>
      <PageHeader
        title="Connection Map"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink font-semibold">{focus.name}</span>
            <TypeBadge type={focus.type}>{ENTITY_TYPE_LABELS[focus.type].singular}</TypeBadge>
            <span className="font-mono text-xs">
              {directCount} direct, {visibleCount} shown
            </span>
          </span>
        }
        actions={
          <>
            {id ? (
              <Link to="/map" className={cn(buttonVariants({ size: 'sm' }))}>
                <ArrowLeft className="size-3.5" />
                Back to the association
              </Link>
            ) : null}
            <Link
              to={entityHref(focus.type, focus.id)}
              className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }))}
            >
              Open record
            </Link>
          </>
        }
      />

      <Panel>
        <div className="border-rule flex flex-wrap items-end justify-between gap-3 border-b p-3">
          <Field label="Centre the map on" className="relative w-full max-w-xs">
            <div className="relative">
              <Search
                className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a resident, lot, or vendor"
                className="pl-8"
                autoComplete="off"
              />
            </div>

            {searchResults.length > 0 ? (
              <ul className="panel panel-enter absolute top-full right-0 left-0 z-40 mt-1 max-h-64 overflow-y-auto p-1">
                {searchResults.map((entity) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      className="hover:bg-paper-sunken flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-13"
                      onClick={() => {
                        setSearch('')
                        navigate(`/map/${entity.id}`)
                      }}
                    >
                      <TypeBadge type={entity.type}>
                        {ENTITY_TYPE_LABELS[entity.type].singular}
                      </TypeBadge>
                      <span className="truncate">{entity.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>

          <TypeFilterBar counts={counts} hiddenTypes={hiddenTypes} onToggle={toggleType} />
        </div>

        <PanelBody className="p-3">
          {directCount === 0 ? (
            <EmptyState
              title={`${focus.name} has no connections to draw`}
              description={
                hiddenTypes.size > 0
                  ? 'Every connected record is currently filtered out. Switch a type back on above.'
                  : 'Record an ownership, residency, board seat, or vendor contract on this record and it will appear here.'
              }
              action={
                <Link
                  to={`${entityHref(focus.type, focus.id)}?tab=connections`}
                  className={cn(buttonVariants({ variant: 'primary' }))}
                >
                  Open connections
                </Link>
              }
            />
          ) : (
            <ConnectionMap
              graph={graph}
              focus={focus}
              hiddenTypes={hiddenTypes}
              onFocusChange={(entity) => navigate(`/map/${entity.id}`)}
            />
          )}
        </PanelBody>

        <PanelFooter className="flex-wrap gap-y-2">
          <span>
            Solid lines are direct connections. Dashed lines are one step further out. Faded cards
            are relationships that have ended.
          </span>
          <span className="font-mono text-xs">click a card to re-centre</span>
        </PanelFooter>
      </Panel>
    </>
  )
}
