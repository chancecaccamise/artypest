import { useCallback, useMemo, useState } from 'react'
import { Columns2, Map as MapIcon, Network, Spline } from 'lucide-react'

import { MapLegend } from './MapLegend'
import { MapPanel } from './MapPanel'
import { normalizePin } from '@/lib/parcels/pin'
import { PlatView, shortPin, type PlatMarker } from './PlatView'
import { useHarvestedParcels } from './use-harvested-parcels'
import { useOverlay } from './use-overlay'
import { RecencyLegend } from '@/components/graph/RecencyLegend'
import { buildRecencyScale } from '@/lib/relations/recency'
import { UnplacedTray } from './UnplacedTray'
import { arcColor, arcableKeys, buildArcs, toggleAllArcKeys, undrawnCounts } from './arcs'
import { THEMATIC_MODES, THEMATIC_MODE_LABELS, buildTheming, type ThematicMode } from './theming'
import { ConnectionMap } from '@/components/graph/ConnectionMap'
import { Button } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/empty-state'
import { Checkbox, Field, Select } from '@/components/ui/field'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocations, useReferenceItems, useSetManualLocation, useGraph } from '@/hooks/use-data'
import { platPins } from '@/lib/geo'
import type { Entity, EntityType } from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { ENTITY_TYPES, ENTITY_TYPE_LABELS } from '@/lib/data/types'
import { humanize, readString } from '@/lib/format'
import { useRole } from '@/lib/role'
import { cn } from '@/lib/utils'

/*
  The map shell.

  It owns filter state, thematic mode, arc selection, and the one piece of
  selection state both views read. It then hands a projected dataset to
  whichever renderer is active.

  When Mapbox arrives, SatelliteView.tsx lands beside PlatView.tsx and a toggle
  goes in this header. That toggle is the swap point: a component boundary, not
  an interface, which is the right abstraction for a renderer.
*/

export type MapMode = 'plat' | 'split'

/** The default when no link asked for connections. Shared, so never mutated. */
const NO_ARC_KEYS: ReadonlySet<string> = new Set()

/**
 * What a link into the plat asks it to draw.
 *
 * `focus` is the Connection Map's "Open in Plat View": this record's
 * connections and nothing else. `all` is the same drawing without the
 * narrowing, for a link that means "show me the whole picture".
 */
export type InitialConnections = 'focus' | 'all'

export interface MapViewProps {
  /** Record to select on open, from the route. */
  initialEntityId?: string | null
  /** Connections to switch on when the map opens. Null leaves them off. */
  initialConnections?: InitialConnections | null
  onSelectionChange?: (entityId: string | null) => void
}

export function MapView({
  initialEntityId,
  initialConnections = null,
  onSelectionChange,
}: MapViewProps) {
  const { graph, isLoading: graphLoading } = useGraph()
  const locationsQuery = useLocations()
  const referenceQuery = useReferenceItems()
  const setManualLocation = useSetManualLocation()
  const { canEdit } = useRole()

  const [mode, setMode] = useState<MapMode>('plat')
  const [thematicMode, setThematicMode] = useState<ThematicMode>('none')
  const [typeFilter, setTypeFilter] = useState<EntityType | ''>('')
  const [dataFilter, setDataFilter] = useState('')
  /*
    Null means the reader has not touched the connections row yet, so the
    drawing follows whatever link opened the page. The moment they switch a
    kind on or off, their choice replaces it and the address bar stops having
    an opinion.

    Derived rather than seeded in an effect, because the kinds worth switching
    on are not known until the graph and the locations have both loaded, and an
    effect that waits for them would set state during a render pass that has
    already drawn an empty plat.
  */
  const [chosenArcKeys, setChosenArcKeys] = useState<Set<string> | null>(null)
  const [focusArcsOnSelection, setFocusArcsOnSelection] = useState(initialConnections !== 'all')
  const [gradeArcsByAge, setGradeArcsByAge] = useState(false)
  /*
    On by default. A one pixel arc at half opacity, over parcel boundaries drawn
    in the same weight, is legible on the laptop it was designed on and gone on
    the screen a board meeting is run from.
  */
  const [boldArcs, setBoldArcs] = useState(true)
  const overlay = useOverlay()
  const [placing, setPlacing] = useState<Entity | null>(null)

  /*
    One piece of selection state, owned here. Neither view owns it, which is
    what keeps the plat and the Connection Map from fighting over which one is
    the source of truth.
  */
  const [selectedId, setSelectedId] = useState<string | null>(initialEntityId ?? null)

  const select = useCallback(
    (entityId: string | null) => {
      setSelectedId(entityId)
      onSelectionChange?.(entityId)
    },
    [onSelectionChange]
  )

  const locations = locationsQuery.data ?? null
  /*
    Every PIN the plat draws, not just the committed fixture's forty.

    This was `platPins()` alone, which is the 40-lot fixture. Colouring by
    occupancy therefore classified forty lots and dropped the other 16,616 into
    "unknown", so picking a colouring appeared to do nothing: 2,084 of the 2,124
    lots on screen changed from one flat grey to a slightly different flat grey.

    The harvested layer arrives after first paint, so this grows when it lands,
    the same way the plat's own geometry does.
  */
  const harvestedParcels = useHarvestedParcels()
  const pins = useMemo(() => {
    const all = new Set(platPins())
    for (const feature of harvestedParcels.collection?.features ?? []) {
      const pin = normalizePin(feature.properties.pin)
      if (pin !== '') all.add(pin)
    }
    return [...all]
  }, [harvestedParcels.collection])

  const theming = useMemo(() => {
    if (!graph || !locations) return null
    return buildTheming({
      mode: thematicMode,
      graph,
      propertyByPin: locations.propertyByPin,
      pins,
      referenceItems: referenceQuery.data ?? [],
    })
  }, [graph, locations, thematicMode, pins, referenceQuery.data])

  const selected = selectedId && graph ? (graph.byId.get(selectedId) ?? null) : null

  const selectedPin = useMemo(() => {
    if (!selected || !locations) return null
    if (selected.type === 'property') return readString(selected.data.pin) || null
    // Selecting a resident lights the lot they resolve to, which is what makes
    // the split view's right-to-left direction visible on the plat.
    return locations.byEntity.get(selected.id)?.pin ?? null
  }, [selected, locations])

  /*
    Filters light and dim rather than add and remove. A parcel filtered out is
    drawn faintly: a hole in a plat reads as missing data, not as a filter.
  */
  const litPins = useMemo(() => {
    if (!locations) return null
    if (typeFilter === '' && dataFilter === '') return null

    const lit = new Set<string>()
    for (const pin of pins) {
      const property = locations.propertyByPin.get(pin)
      if (!property) continue
      if (typeFilter !== '' && typeFilter !== 'property') continue
      if (dataFilter !== '') {
        const haystack = `${property.name} ${JSON.stringify(property.data)}`.toLowerCase()
        if (!haystack.includes(dataFilter.toLowerCase())) continue
      }
      lit.add(pin)
    }
    return lit
  }, [locations, pins, typeFilter, dataFilter])

  /** Point markers: everything placed that is not itself a drawn lot. */
  const drawnLots = useMemo(() => new Set(pins), [pins])

  const markers = useMemo<PlatMarker[]>(() => {
    if (!graph || !locations) return []

    const rows: PlatMarker[] = []
    for (const [entityId, location] of locations.byEntity) {
      const entity = graph.byId.get(entityId)
      if (!entity) continue
      // A lot is drawn as a polygon, so a dot on top of it is noise.
      if (entity.type === 'property') continue
      if (typeFilter !== '' && entity.type !== typeFilter) continue
      if (dataFilter !== '' && !entity.name.toLowerCase().includes(dataFilter.toLowerCase())) {
        continue
      }
      rows.push({
        entity,
        location,
        onDrawnLot: location.pin !== null && drawnLots.has(location.pin),
      })
    }
    return rows
  }, [graph, locations, typeFilter, dataFilter, drawnLots])

  const availableArcKeys = useMemo(
    () => (graph && locations ? arcableKeys(graph, locations) : []),
    [graph, locations]
  )

  const arcKeys = useMemo(
    () =>
      chosenArcKeys ??
      (initialConnections === null ? NO_ARC_KEYS : new Set(availableArcKeys)),
    [chosenArcKeys, initialConnections, availableArcKeys]
  )

  const arcs = useMemo(() => {
    if (!graph || !locations) return []
    return buildArcs({
      graph,
      locations,
      keys: arcKeys,
      focusEntityId: focusArcsOnSelection ? selectedId : null,
    })
  }, [graph, locations, arcKeys, focusArcsOnSelection, selectedId])

  /* The same arcs the plat grades, so the legend's dates are the real ends. */
  const arcScale = useMemo(
    () => buildRecencyScale(arcs.map((arc) => ({ id: arc.relationId, startDate: arc.startDate }))),
    [arcs]
  )

  /* The same focus the arcs are built with, so the note counts what is missing
     from the drawing on screen rather than from the association as a whole. */
  const undrawn = useMemo(
    () =>
      graph && locations
        ? undrawnCounts(graph, locations, arcKeys, focusArcsOnSelection ? selectedId : null)
        : { unplacedEnd: 0, sameLocation: 0 },
    [graph, locations, arcKeys, focusArcsOnSelection, selectedId]
  )

  const arcsShown = arcKeys.size > 0

  const toggleArcKey = (key: string) => {
    const next = new Set(arcKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setChosenArcKeys(next)
  }

  const handlePlace = useCallback(
    (point: Point) => {
      if (!placing) return
      setManualLocation.mutate({ entityId: placing.id, point })
      select(placing.id)
      setPlacing(null)
    },
    [placing, setManualLocation, select]
  )

  const labelForPin = useCallback(
    (pin: string) => {
      const property = locations?.propertyByPin.get(pin)
      return readString(property?.data.lotNumber) || shortPin(pin)
    },
    [locations]
  )

  const handleSelectPin = useCallback(
    (pin: string | null) => {
      if (!pin || !locations) {
        select(null)
        return
      }
      const property = locations.propertyByPin.get(pin)
      select(property?.id ?? null)
    },
    [locations, select]
  )

  if (graphLoading || !graph || !locations || !theming) {
    return (
      <Panel className="h-[38rem]">
        <div className="flex h-full flex-col gap-3 p-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-full w-full" />
        </div>
      </Panel>
    )
  }

  if (locations.propertyByPin.size === 0) {
    return (
      <Panel>
        <div className="p-4">
          <EmptyState
            title="No parcel geometry is on file"
            description="The plat draws the boundaries the county publishes. Import parcel data, or add lots with parcel numbers, and the drawing fills in."
          />
        </div>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        {/* Controls */}
        <div className="border-rule flex flex-wrap items-end gap-3 border-b p-3">
          <Field label="Colour lots by" className="w-52">
            <Select
              value={thematicMode}
              onChange={(event) => setThematicMode(event.target.value as ThematicMode)}
            >
              {THEMATIC_MODES.map((value) => (
                <option key={value} value={value}>
                  {THEMATIC_MODE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            One boundary set at a time. A lot sits inside a commission district
            and a voting precinct and a sanitation route simultaneously, and
            drawing three sets of boundaries over a plat is unreadable.

            Absent entirely when the harvest has not been run, rather than shown
            as an empty control that does nothing.
          */}
          {overlay.available.length > 0 ? (
            <Field label="District overlay" className="w-56">
              <Select
                value={overlay.active}
                onChange={(event) => {
                  overlay.setActive(event.target.value)
                }}
              >
                <option value="">No overlay</option>
                {overlay.available.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Show records" className="w-44">
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as EntityType | '')}
            >
              <option value="">Every type</option>
              {ENTITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ENTITY_TYPE_LABELS[value].plural}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Filter text" className="w-48">
            <input
              type="search"
              value={dataFilter}
              onChange={(event) => setDataFilter(event.target.value)}
              placeholder="Address, owner, zoning"
              className="border-rule bg-paper-raised text-ink placeholder:text-ink-faint hover:border-rule-strong h-9 w-full rounded-[3px] border px-2.5 text-sm transition-colors duration-[120ms]"
            />
          </Field>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant={mode === 'plat' ? 'primary' : 'secondary'}
              onClick={() => setMode('plat')}
              aria-pressed={mode === 'plat'}
            >
              <MapIcon className="size-3.5" />
              Plat
            </Button>
            <Button
              size="sm"
              variant={mode === 'split' ? 'primary' : 'secondary'}
              onClick={() => setMode('split')}
              aria-pressed={mode === 'split'}
              className="hidden lg:inline-flex"
            >
              <Columns2 className="size-3.5" />
              Split with the Connection Map
            </Button>
          </div>
        </div>

        {/* Arc filter, off by default */}
        <div className="border-rule flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {/*
            One button, not a row of chips to work out.

            This row used to open with the word "Connections" set as a caption,
            followed by chips named after relation types. It read as a legend
            rather than as a control, so the plat's best feature was reachable
            only by a reader who already knew the chips were buttons. The chips
            are still here to narrow down with, after the question "show me
            what connects to what" has been answered in one click.
          */}
          <Button
            size="sm"
            variant={arcsShown ? 'primary' : 'secondary'}
            aria-pressed={arcsShown}
            onClick={() => setChosenArcKeys(toggleAllArcKeys(arcKeys, availableArcKeys))}
            disabled={availableArcKeys.length === 0}
          >
            <Spline className="size-3.5" />
            {arcsShown ? 'Hide connections' : 'Show connections'}
          </Button>

          {availableArcKeys.map((key) => {
            const active = arcKeys.has(key)
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleArcKey(key)}
                className={cn(
                  'rounded-[3px] border px-2 py-0.5 text-xs font-semibold transition-colors duration-[120ms]',
                  active ? '' : 'border-rule text-ink-faint'
                )}
                style={
                  active
                    ? {
                        color: arcColor(key),
                        borderColor: `color-mix(in srgb, ${arcColor(key)} 45%, transparent)`,
                        backgroundColor: `color-mix(in srgb, ${arcColor(key)} 14%, transparent)`,
                      }
                    : undefined
                }
              >
                {humanize(key)}
              </button>
            )
          })}

          {arcsShown ? (
            <>
              <Checkbox
                label="Only the selected record"
                checked={focusArcsOnSelection}
                onChange={(event) => setFocusArcsOnSelection(event.target.checked)}
                className="ml-2"
              />
              <Checkbox
                label="Bold lines"
                checked={boldArcs}
                onChange={(event) => setBoldArcs(event.target.checked)}
              />
              <Checkbox
                label="Grade by age"
                checked={gradeArcsByAge}
                onChange={(event) => setGradeArcsByAge(event.target.checked)}
              />
            </>
          ) : (
            <span className="text-ink-faint text-xs">
              {availableArcKeys.length === 0
                ? 'Nothing to draw yet: a connection needs both records placed on the map.'
                : 'Off by default. Show connections draws every kind at once, or pick a single kind.'}
            </span>
          )}
        </div>

        {arcsShown && gradeArcsByAge ? (
          <div className="border-rule border-b px-3 py-2">
            <RecencyLegend scale={arcScale} groupedBy="type" />
          </div>
        ) : null}

        {arcsShown && (undrawn.unplacedEnd > 0 || undrawn.sameLocation > 0) ? (
          <div className="border-rule border-b px-3 py-2">
            <Notice tone="info">
              <span>
                {undrawn.sameLocation > 0 ? (
                  <>
                    {undrawn.sameLocation === 1
                      ? 'One of these connections joins'
                      : `${String(undrawn.sameLocation)} of these connections join`}{' '}
                    two records that resolve to the same spot, usually an owner living in the lot
                    they own, so there is no line to draw.{' '}
                  </>
                ) : null}
                {undrawn.unplacedEnd > 0 ? (
                  <>
                    {undrawn.unplacedEnd === 1 ? 'One' : undrawn.unplacedEnd}
                    {undrawn.sameLocation > 0 ? ' more' : ''}
                    {undrawn.unplacedEnd === 1
                      ? ' has one end with no location, and is listed'
                      : ' have one end with no location, and are listed'}{' '}
                    in the unplaced records below.
                  </>
                ) : null}
              </span>
            </Notice>
          </div>
        ) : null}

        {/* The drawing, the panel, and, in split mode, the Connection Map */}
        <div
          className={cn(
            'grid min-h-0',
            mode === 'split' ? 'lg:grid-cols-[1fr_1fr_20rem]' : 'lg:grid-cols-[1fr_20rem]'
          )}
        >
          <div className="border-rule h-[26rem] border-b lg:h-[38rem] lg:border-r lg:border-b-0">
            <PlatView
              gradeArcsByAge={gradeArcsByAge}
              boldArcs={boldArcs}
              overlay={overlay.collection}
              theming={theming}
              litPins={litPins}
              selectedPin={selectedPin}
              markers={markers}
              selectedEntityId={selectedId}
              arcs={arcs}
              onSelectPin={handleSelectPin}
              onSelectEntity={select}
              labelForPin={labelForPin}
              placingEntity={placing}
              onPlace={handlePlace}
            />
          </div>

          {mode === 'split' ? (
            <div className="border-rule hidden min-h-0 overflow-auto border-r lg:block lg:h-[38rem]">
              {selected ? (
                <ConnectionMap
                  graph={graph}
                  focus={selected}
                  hiddenTypes={new Set()}
                  onFocusChange={(entity) => select(entity.id)}
                />
              ) : (
                <div className="p-4">
                  <EmptyState
                    title="Select a lot to see what connects to it"
                    description="The Connection Map re-centres on whatever is selected on the plat, and selecting a card here lights that record's lot."
                  />
                </div>
              )}
            </div>
          ) : null}

          <div className="border-rule flex min-h-0 flex-col border-t lg:h-[38rem] lg:border-t-0">
            <MapPanel
              entity={selected}
              graph={graph}
              locations={locations}
              onClose={() => select(null)}
              onPlace={(entity) => setPlacing(entity)}
              onFocusConnections={(entityId) => {
                select(entityId)
                setMode('split')
              }}
              canEdit={canEdit}
            />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="border-rule flex items-center gap-2 border-b px-3 py-2">
            <Network className="text-ink-muted size-4" aria-hidden="true" />
            <h2 className="label-caps">Unplaced records</h2>
          </div>
          <div className="p-3">
            <UnplacedTray
              unplaced={locations.unplaced}
              selectedEntityId={selectedId}
              onSelect={select}
              onPlace={(entity) => setPlacing(entity)}
              canEdit={canEdit}
            />
          </div>
        </Panel>

        {theming.legend.length > 0 ? (
          <Panel>
            <div className="p-3">
              <MapLegend theming={theming} />
            </div>
          </Panel>
        ) : (
          <Panel>
            <div className="text-ink-muted p-3 text-13">
              Choose a colouring above to see how the lots break down. The plat itself is
              deliberately uncoloured by default: linework first, data on top of it.
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
