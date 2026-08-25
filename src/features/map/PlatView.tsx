import { select } from 'd3-selection'
import { zoom as d3Zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Crosshair, LocateFixed, Maximize2, Minus, Plus } from 'lucide-react'

import { arcColor, arcPath, type MapArc } from './arcs'
import { buildRecencyScale } from '@/lib/relations/recency'
import {
  buildProjection,
  frameTransform,
  projectOverlay,
  shouldLabel,
  shouldLabelOverlay,
  shouldLabelStreet,
  type ParcelPath,
} from './projection'
import type { OverlayCollection } from '@/lib/overlays'
import { useHarvestedParcels } from './use-harvested-parcels'
import type { Theming } from './theming'
import { Button } from '@/components/ui/button'
import { entityTypeColor } from '@/components/ui/badge'
import type { Entity, ResolvedLocation } from '@/lib/data/types'
import type { Point } from '@/lib/geocoding/types'
import { readString } from '@/lib/format'
import { normalizePin } from '@/lib/parcels/pin'
import { cn } from '@/lib/utils'

/*
  The plat renderer.

  This is the one file the Mapbox swap replaces. Everything it consumes,
  projection, theming, arcs, resolved locations, is computed elsewhere and
  survives untouched, which is the whole argument for building the plat now.

  Parcel polygons drawn as SVG with no basemap, hairline strokes, and monospace
  lot numbers is a plat drawing. It is not a placeholder for a map: it is the
  drawing this audience already reads, and it stays as a second view mode when
  satellite arrives.
*/

const MIN_ZOOM = 0.5

/*
  The harvested map is eight kilometres of city. Framed whole, a typical lot
  is about two pixels across, so the old ceiling of 20 could only ever get one up
  to roughly fifty pixels: visible, but not a drawing anybody could read. This
  allows a single lot to fill the view, which is what "show me this address"
  means.
*/
const MAX_ZOOM = 250

/*
  A lot narrower than this on screen is too small to read, so arriving at one
  counts as not having arrived. Used to decide whether a selection needs the
  view moved.
*/
const READABLE_LOT_PX = 40

/** How much of the viewport a lot fills when the plat navigates to it. */
const FOCUS_FILL = 0.45

/*
  How much of the viewport an area fills when the plat frames a group of things.
  Lower than FOCUS_FILL because the point of framing a group is the street
  pattern around it: a lot with no context is a rectangle.
*/
const FRAME_FILL = 0.78

/*
  The most lots drawn at once. The harvested layer holds 16,656, and at any zoom
  where a reader is looking at lots rather than at the shape of the city far
  fewer than this are on screen, so the cap only bites when fully zoomed out.
  When it does, the plat says so: quietly drawing part of a neighborhood would be
  the same silent-gap problem the harvester exists to prevent.

  Measured, not guessed. Panning the full extent in headless Chrome, median
  frame time against the ceiling, with the 4,755 street segments drawn
  underneath in every case:

    3,000 -> 37ms     9,000 -> 53ms
    6,000 -> 45ms    16,656 -> 73ms   (no cap at all)

  There is no cliff to sit below, just a steady 2.7ms per extra thousand lots,
  so this is a judgement rather than a threshold. 6,000 is twice what the old
  ceiling showed of a layer 60% larger, which puts a reader back ahead of where
  they were, and it costs about a fifth more frame time than 3,000 did.

  Those absolute numbers come from a headless browser rasterising in software
  and are pessimistic. It is the slope between them that decided this.
*/
const MAX_DRAWN_PARCELS = 6000

/** Below this the plat draws every lot and never consults the viewport. */
const CULL_THRESHOLD = 500

export interface PlatMarker {
  entity: Entity
  location: ResolvedLocation
  /**
   * True when this marker sits on a lot the plat already draws, because the
   * record borrowed its location from that lot.
   *
   * Those markers are drawn but never take a click: they sit exactly on the
   * centroid, which is where a reader naturally clicks to select the lot, and
   * intercepting that made the plat feel broken. The lot's own panel lists
   * everyone who resolves onto it, so nothing is lost.
   */
  onDrawnLot: boolean
}

export interface PlatViewProps {
  theming: Theming
  /** Lots drawn at full strength. Everything else is drawn faintly. */
  litPins: Set<string> | null
  selectedPin: string | null
  /** Point markers for records that are not lots. */
  markers: PlatMarker[]
  selectedEntityId: string | null
  arcs: MapArc[]
  /** Grade the arcs by how recent each connection is. */
  gradeArcsByAge?: boolean
  /** The district boundaries drawn under the lots. One at a time. */
  overlay?: OverlayCollection | null
  onSelectPin: (pin: string | null) => void
  onSelectEntity: (entityId: string) => void
  /**
   * The label a lot carries on the drawing. A plat is annotated with lot
   * numbers, so that is what this returns when the record has one; the tail of
   * the parcel number is the fallback, because an unlabelled lot is worse than
   * one labelled with a code.
   */
  labelForPin: (pin: string) => string
  /** Active while the user is placing a record by hand. */
  placingEntity: Entity | null
  onPlace: (point: Point) => void
  className?: string
}

export function PlatView({
  theming,
  litPins,
  selectedPin,
  markers,
  selectedEntityId,
  arcs,
  gradeArcsByAge = false,
  overlay = null,
  onSelectPin,
  onSelectEntity,
  labelForPin,
  placingEntity,
  onPlace,
  className,
}: PlatViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const [size, setSize] = useState({ width: 960, height: 640 })
  /*
    The zoom behaviour is created once and reads the current size through this
    ref, so a resize does not tear it down and lose the reader's position.
  */
  const sizeRef = useRef(size)
  const [transform, setTransform] = useState(() => zoomIdentity)
  /*
    The same value as `transform`, readable without subscribing to it. The
    navigation effect below needs to know where the view currently is, but must
    not re-run every time it moves, or panning away from a selected lot would
    snap straight back to it.
  */
  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  }, [transform])
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const apply = (width: number, height: number) => {
      const next = { width: Math.max(width, 1), height: Math.max(height, 1) }
      // Written here rather than during render, so the zoom behaviour can read
      // the current size without the component reaching for a ref mid-render.
      sizeRef.current = next
      setSize(next)
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      apply(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    apply(element.clientWidth, element.clientHeight)
    return () => observer.disconnect()
  }, [])

  /*
    Path strings depend only on geometry and viewport size, never on pan or
    zoom, so they are computed once per size and the transform on the parent
    group does all navigation. Recomputing path data per pan frame is the one
    mistake that makes this feel slow.
  */
  const harvested = useHarvestedParcels()

  const projection = useMemo(
    () =>
      buildProjection(
        size.width,
        size.height,
        harvested.collection ?? undefined,
        harvested.streets ?? undefined
      ),
    [size.width, size.height, harvested.collection, harvested.streets]
  )

  /*
    Only the lots on screen are drawn.

    With the harvested layer loaded this is over sixteen thousand polygons, and
    an SVG that renders all of them repaints every pan frame. The path strings
    are still computed once per size, as before: this decides which of them the
    browser is asked to lay out.

    Fully zoomed out every lot is on screen and culling cannot help, so there is
    also a ceiling. When it bites the plat says so rather than quietly drawing
    part of the neighbourhood, which would be the same silent-gap problem the
    harvester exists to avoid.
  */
  /*
    Largest first, sorted once per projection rather than once per pan frame.

    The cap has to keep the lots a reader can actually see rather than an
    arbitrary slice, and ranking by area is how. But area does not change when
    the view moves, so sorting inside the per-frame memo was re-sorting sixteen
    thousand lots on every frame of every pan, which measurably cost more than
    the paths it was there to avoid drawing.
  */
  const parcelsByArea = useMemo(
    () => [...projection.parcels].sort((a, b) => b.area - a.area),
    [projection.parcels]
  )

  /*
    The viewport in pre-transform space, which is what projected bounds are
    measured in. Shared by the lot culling and the overlay labels rather than
    computed twice from the same three numbers.
  */
  const viewport = useMemo(() => {
    const { k, x, y } = transform
    return {
      left: -x / k,
      top: -y / k,
      right: (size.width - x) / k,
      bottom: (size.height - y) / k,
    }
  }, [transform, size.width, size.height])

  /*
    Recomputed when the reader picks a different boundary set or the plat
    resizes, and not when they pan: the paths are in pre-transform space, like
    the lots, so panning is a transform on the group rather than new geometry.
  */
  const projectedOverlay = useMemo(
    () => (overlay ? projectOverlay(overlay, projection.project) : []),
    [overlay, projection]
  )

  /*
    Where each district's label goes.

    Not simply the centroid. A voting precinct is far larger than the plat's
    opening view, so its centroid is usually off screen and the label with it,
    which leaves a reader looking at boundaries they cannot identify. The label
    is pinned to the centroid where that is visible and slid to stay inside the
    part of the district that is on screen where it is not.
  */
  const overlayLabels = useMemo(() => {
    const inset = 44 / transform.k

    return projectedOverlay.flatMap((area) => {
      const [minX, minY, maxX, maxY] = area.bounds
      const onScreen =
        maxX >= viewport.left &&
        minX <= viewport.right &&
        maxY >= viewport.top &&
        minY <= viewport.bottom
      if (!onScreen) return []

      // The overlap between the district and the view, kept off the very edge.
      const left = Math.max(minX, viewport.left + inset)
      const right = Math.min(maxX, viewport.right - inset)
      const top = Math.max(minY, viewport.top + inset)
      const bottom = Math.min(maxY, viewport.bottom - inset)
      if (right < left || bottom < top) return []

      return [
        {
          area,
          x: Math.min(Math.max(area.centroid[0], left), right),
          y: Math.min(Math.max(area.centroid[1], top), bottom),
        },
      ]
    })
  }, [projectedOverlay, viewport, transform.k])

  const visibleParcels = useMemo(() => {
    /*
      A small plat is drawn whole. Culling buys nothing at 40 lots, and it costs
      correctness anywhere the container has not been measured yet: an unmeasured
      element is one pixel wide, every lot falls outside it, and the plat renders
      empty. Below this many parcels the viewport is not consulted at all.
    */
    if (projection.parcels.length <= CULL_THRESHOLD) {
      return { parcels: projection.parcels, capped: 0 }
    }

    const { left, top, right, bottom } = viewport

    /*
      One pass in area order: keep the first MAX_DRAWN_PARCELS that are on
      screen, and go on counting the rest so the notice can say how many were
      left out. Counting to the end is what makes "of 16,656" true; stopping
      early would make it a guess.
    */
    const parcels = []
    let onScreen = 0
    for (const parcel of parcelsByArea) {
      const [minX, minY, maxX, maxY] = parcel.bounds
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue
      onScreen += 1
      if (parcels.length < MAX_DRAWN_PARCELS) parcels.push(parcel)
    }

    return { parcels, capped: onScreen - parcels.length }
  }, [projection.parcels, parcelsByArea, viewport])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const behaviour = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      /*
        The extent is set explicitly rather than left to d3's default, which
        reads the SVG element's width and height attributes as animated
        lengths. The measured size is the better answer anyway, and the
        default throws outright under jsdom.
      */
      .extent((): [[number, number], [number, number]] => [
        [0, 0],
        [sizeRef.current.width, sizeRef.current.height],
      ])
      /* Keeps the plat from being panned entirely out of view. */
      .translateExtent([
        [-sizeRef.current.width, -sizeRef.current.height],
        [sizeRef.current.width * 2, sizeRef.current.height * 2],
      ])
      /*
        d3's own default filter, plus one guard: a drag gesture is tracked
        through `event.view`, and an environment that leaves that null makes
        d3 throw on the first mousedown. Refusing to start a gesture we cannot
        follow is the honest response either way.
      */
      .filter((event: MouseEvent) => {
        if (event.ctrlKey && event.type !== 'wheel') return false
        if (event.button) return false
        return event.type === 'wheel' || event.view !== null
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform(event.transform)
      })

    zoomRef.current = behaviour
    select(svg).call(behaviour)

    return () => {
      select(svg).on('.zoom', null)
      zoomRef.current = null
    }
  }, [])

  /*
    Take the reader to the selected lot.

    Selecting a record elsewhere in the app routes to /plat/:id, which until now
    highlighted the lot without moving the view. At full extent that meant
    landing on a two pixel mark somewhere in eight kilometres of city, which reads
    exactly like nothing having happened.

    The view only moves when it needs to. A lot already on screen at a readable
    size is left alone, so clicking around the plat does not yank the viewport
    out from under the reader: that case is arriving at something already
    visible. It is the off-screen or too-small case that is a navigation.

    Applied instantly rather than tweened, for the same reason the zoom buttons
    are: d3-transition is a dependency bought for an effect that
    prefers-reduced-motion would turn off anyway.
  */
  useEffect(() => {
    if (!selectedPin) return

    const svg = svgRef.current
    const behaviour = zoomRef.current
    if (!svg || !behaviour) return

    const parcel = projection.parcelByPin.get(normalizePin(selectedPin))
    if (!parcel) return

    const [minX, minY, maxX, maxY] = parcel.bounds
    const lotWidth = Math.max(maxX - minX, 1)
    const lotHeight = Math.max(maxY - minY, 1)

    const { k, x, y } = transformRef.current
    const onScreen = {
      left: minX * k + x,
      top: minY * k + y,
      right: maxX * k + x,
      bottom: maxY * k + y,
    }

    const visible =
      onScreen.left >= 0 &&
      onScreen.top >= 0 &&
      onScreen.right <= size.width &&
      onScreen.bottom <= size.height
    const readable =
      lotWidth * k >= READABLE_LOT_PX || lotHeight * k >= READABLE_LOT_PX

    if (visible && readable) return

    const scale = Math.min(
      Math.max(
        (FOCUS_FILL * Math.min(size.width, size.height)) / Math.max(lotWidth, lotHeight),
        MIN_ZOOM
      ),
      MAX_ZOOM
    )
    const centreX = (minX + maxX) / 2
    const centreY = (minY + maxY) / 2

    const next = zoomIdentity
      .translate(size.width / 2, size.height / 2)
      .scale(scale)
      .translate(-centreX, -centreY)

    // Through the behaviour, so d3 keeps its own internal transform in step and
    // the next wheel or drag continues from here rather than snapping back.
    select(svg).call((selection) => behaviour.transform(selection, next))
    /*
      Deliberately not depending on `transform`. This fires when the selection
      changes, when the harvested geometry arrives and the lot first exists, or
      when the viewport resizes. Panning and zooming afterwards is the reader's,
      and is left alone.
    */
  }, [selectedPin, projection, size.width, size.height])

  /*
    Where the association's own records sit, in projected space.

    The plat draws every lot the county recorded, which is 16,656 of them across
    eight kilometres of city. The association tracks about fifty. Framed to the
    whole drawing those fifty are a smudge a hundred pixels wide, and a reader
    who switches connections on sees nothing happen: the arcs are drawn, at a
    zoom where an arc is shorter than a stroke is wide.

    So the plat opens on the records rather than on the county. The county is
    still all there, one scroll out.
  */
  const recordBounds = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const grow = (x: number, y: number) => {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }

    for (const marker of markers) {
      const point = projection.project(marker.location.point)
      if (point) grow(point[0], point[1])
    }

    // Whole lots rather than their centres, so a lot on the edge is not clipped.
    for (const marker of markers) {
      const pin = marker.location.pin
      if (pin === null || pin === undefined) continue
      const parcel = projection.parcelByPin.get(normalizePin(pin))
      if (!parcel) continue
      grow(parcel.bounds[0], parcel.bounds[1])
      grow(parcel.bounds[2], parcel.bounds[3])
    }

    return minX === Infinity ? null : ([minX, minY, maxX, maxY] as const)
  }, [markers, projection])

  const arcBounds = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const arc of arcs) {
      for (const point of [projection.project(arc.from), projection.project(arc.to)]) {
        if (!point) continue
        if (point[0] < minX) minX = point[0]
        if (point[1] < minY) minY = point[1]
        if (point[0] > maxX) maxX = point[0]
        if (point[1] > maxY) maxY = point[1]
      }
    }

    return minX === Infinity ? null : ([minX, minY, maxX, maxY] as const)
  }, [arcs, projection])

  /**
   * Frame an area of the drawing, with room around it.
   *
   * The same arithmetic the select-a-lot effect does, pulled out so that
   * opening the plat, switching connections on, and arriving at a record all
   * frame things the same way rather than three slightly different ways.
   */
  const frame = useCallback(
    (bounds: readonly [number, number, number, number]) => {
      const svg = svgRef.current
      const behaviour = zoomRef.current
      if (!svg || !behaviour) return
      if (size.width <= 1 || size.height <= 1) return

      const { k, x, y } = frameTransform(
        bounds,
        size.width,
        size.height,
        FRAME_FILL,
        MIN_ZOOM,
        MAX_ZOOM
      )
      const next = zoomIdentity.translate(x, y).scale(k)

      select(svg).call((selection) => behaviour.transform(selection, next))
    },
    [size.width, size.height]
  )

  /*
    Open on the association's records, once, when there is something to open on.

    Once, and only once: after that the view belongs to the reader. `framedOnce`
    is a ref rather than state because changing it must not itself cause a
    render that re-runs this.
  */
  const framedOnce = useRef(false)
  useEffect(() => {
    if (framedOnce.current) return
    if (size.width <= 1 || size.height <= 1) return
    /*
      Nothing to zoom into while the plat is still the committed 40-lot fixture,
      which is what it holds until the harvested geometry is fetched. Returning
      without latching matters: latching here meant the flag was already set
      when the 16,656 lots landed a moment later, so the plat opened on the
      whole county after all and this effect never fired again.
    */
    if (projection.parcels.length <= CULL_THRESHOLD) return
    if (!recordBounds) return

    framedOnce.current = true
    frame(recordBounds)
  }, [recordBounds, frame, size.width, size.height, projection.parcels.length])

  /*
    Switching a connection type on is a request to look at those connections, so
    the plat goes to them. Keyed on the set of relation ids rather than on the
    arcs array, which is rebuilt on every pan.
  */
  const arcSignature = useMemo(
    () => arcs.map((arc) => arc.relationId).join(','),
    [arcs]
  )
  const lastArcSignature = useRef('')
  useEffect(() => {
    if (arcSignature === lastArcSignature.current) return
    const previous = lastArcSignature.current
    lastArcSignature.current = arcSignature
    // Only when arcs appear or change, never when the last one is switched off.
    if (arcSignature === '' || previous === arcSignature) return
    if (!arcBounds) return
    frame(arcBounds)
  }, [arcSignature, arcBounds, frame])

  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current
    const behaviour = zoomRef.current
    if (!svg || !behaviour) return
    /*
      Applied instantly rather than tweened: d3-transition is another
      dependency for an effect prefers-reduced-motion would disable anyway.

      Wrapped in an arrow because d3 hands these out as unbound methods, and
      passing one straight to `call` loses its receiver.
    */
    select(svg).call((selection) => behaviour.scaleBy(selection, factor))
  }, [])

  /*
    Every lot the county recorded, which is the whole harvest and not the
    association. The plat no longer opens here, so this is the way back out to
    the city rather than the default view.
  */
  const fitToView = useCallback(() => {
    const svg = svgRef.current
    const behaviour = zoomRef.current
    if (!svg || !behaviour) return
    // fitExtent already framed the projection, so identity is the whole drawing.
    select(svg).call((selection) => behaviour.transform(selection, zoomIdentity))
  }, [])

  /** Screen point to longitude and latitude, for hand placement. */
  const handleClick = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!placingEntity) return
      const svg = svgRef.current
      if (!svg) return

      const bounds = svg.getBoundingClientRect()
      const [x, y] = transform.invert([event.clientX - bounds.left, event.clientY - bounds.top])
      const point = projection.invert([x ?? 0, y ?? 0])
      if (point) onPlace(point)
    },
    [placingEntity, projection, transform, onPlace]
  )

  const zoomLevel = transform.k
  const strokeWidth = 1 / zoomLevel

  const projectedMarkers = useMemo(() => {
    return markers
      .map((marker) => {
        const screen = projection.project(marker.location.point)
        return screen ? { ...marker, screen } : null
      })
      .filter((marker): marker is PlatMarker & { screen: [number, number] } => marker !== null)
  }, [markers, projection])

  /*
    One ramp per kind of connection, not one for the plat.

    Same reasoning as the Connection Map's per-fan ramps: a reader with "member
    of" and "resides at" both switched on is comparing memberships to
    memberships. A single ramp would spend its range on the gap between the two
    types, and every membership would land in the same narrow band.
  */
  const arcScales = useMemo(() => {
    const byKey = new Map<string, { id: string; startDate: string | null }[]>()
    for (const arc of arcs) {
      const row = { id: arc.relationId, startDate: arc.startDate }
      const group = byKey.get(arc.relationKey)
      if (group) group.push(row)
      else byKey.set(arc.relationKey, [row])
    }

    const scales = new Map<string, ReturnType<typeof buildRecencyScale>>()
    for (const [key, group] of byKey) scales.set(key, buildRecencyScale(group))
    return scales
  }, [arcs])

  const projectedArcs = useMemo(() => {
    return arcs
      .map((arc) => {
        const from = projection.project(arc.from)
        const to = projection.project(arc.to)
        if (!from || !to) return null
        return { arc, d: arcPath(from, to) }
      })
      .filter((row): row is { arc: MapArc; d: string } => row !== null)
  }, [arcs, projection])

  return (
    <div ref={containerRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      {/*
        Said out loud, because a plat that has quietly dropped two thirds of the
        city looks exactly like a plat of a smaller city.
      */}
      {visibleParcels.capped > 0 ? (
        <div className="border-rule bg-paper-raised text-ink-muted absolute top-2 left-2 z-10 rounded-[3px] border px-2 py-1 text-xs">
          Showing {visibleParcels.parcels.length.toLocaleString()} of{' '}
          {projection.parcels.length.toLocaleString()} lots. Zoom in to see the rest.
        </div>
      ) : null}

      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        role="img"
        aria-label={
          visibleParcels.capped > 0
            ? `Plat, showing ${visibleParcels.parcels.length} of ${projection.parcels.length} lots. Zoom in for the rest.`
            : `Plat of the subdivision, ${projection.parcels.length} lots`
        }
        className={cn(
          'block h-full w-full touch-none',
          placingEntity ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        )}
        onPointerDown={handleClick}
      >
        <g transform={transform.toString()}>
          {/* Layer order matches the Mapbox implementation's, so the mental
              model transfers even though the code does not. */}
          <g className="parcels">
            {visibleParcels.parcels.map((parcel) => (
              <Parcel
                key={parcel.pin}
                parcel={parcel}
                fill={theming.colorForPin(parcel.pin)}
                lit={litPins === null || litPins.has(parcel.pin)}
                selected={parcel.pin === selectedPin}
                hovered={parcel.pin === hoveredPin}
                strokeWidth={strokeWidth}
                onSelect={onSelectPin}
                onHover={setHoveredPin}
              />
            ))}
          </g>

          <g className="streets" pointerEvents="none">
            {projection.streets.map((street) => (
              <path
                key={street.id}
                id={`street-${street.id}`}
                d={street.d}
                fill="none"
                stroke="var(--rule-strong)"
                strokeWidth={2 / zoomLevel}
                strokeLinecap="round"
              />
            ))}
          </g>

          {/*
            Drawn over the lots and the streets so the boundary reads as the
            region containing them, and under the connections and pins so the
            association's own records stay on top of the county's geography.
          */}
          <g className="overlay" pointerEvents="none">
            {projectedOverlay.map((area) => (
              <path
                key={`overlay-${area.name}`}
                d={area.d}
                fill="var(--survey)"
                fillOpacity={0.06}
                stroke="var(--survey)"
                strokeWidth={2 / zoomLevel}
                strokeLinejoin="round"
              />
            ))}
          </g>

          <g className="arcs" pointerEvents="none">
            {projectedArcs.map(({ arc, d }) => {
              /*
                Ungraded, an arc sits at 0.55 so it reads over the lots without
                burying them. Graded, that ceiling becomes what the most recent
                connection gets and everything older is drawn back from it, so
                switching Age on never makes the plat louder than it was.
              */
              const strength = gradeArcsByAge
                ? (arcScales.get(arc.relationKey)?.strengthOf(arc.relationId) ?? 1)
                : 1
              const opacity = (arc.current ? 0.55 : 0.3) * strength

              return (
                <path
                  key={arc.relationId}
                  d={d}
                  fill="none"
                  stroke={arcColor(arc.relationKey)}
                  strokeWidth={1 / zoomLevel}
                  strokeDasharray={arc.current ? undefined : `${3 / zoomLevel} ${3 / zoomLevel}`}
                  opacity={opacity}
                />
              )
            })}
          </g>

          <g className="pins">
            {projectedMarkers.map((marker) => (
              <Marker
                key={marker.entity.id}
                marker={marker}
                selected={marker.entity.id === selectedEntityId}
                zoom={zoomLevel}
                onSelect={onSelectEntity}
              />
            ))}
          </g>

          <g className="overlay-labels" pointerEvents="none">
            {overlayLabels.map(({ area, x, y }) =>
              shouldLabelOverlay(area, zoomLevel) ? (
                <text
                  key={`overlay-label-${area.name}`}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fontSize={13 / zoomLevel}
                  fill="var(--survey)"
                  letterSpacing={1 / zoomLevel}
                  style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                >
                  {area.name}
                </text>
              ) : null
            )}
          </g>

          <g className="labels" pointerEvents="none">
            {/* Street names follow the centreline, which a raster basemap
                cannot do as cleanly. */}
            {projection.streets.map((street) =>
              shouldLabelStreet(street, zoomLevel) ? (
                <text
                  key={`label-${street.id}`}
                  fontSize={11 / zoomLevel}
                  fill="var(--ink-muted)"
                  letterSpacing={2 / zoomLevel}
                  style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                >
                  <textPath href={`#street-${street.id}`} startOffset="42%" textAnchor="middle">
                    {street.name}
                  </textPath>
                </text>
              ) : null
            )}

            {visibleParcels.parcels.map((parcel) =>
              shouldLabel(parcel, zoomLevel) ? (
                <text
                  key={`lot-${parcel.pin}`}
                  x={parcel.centroid[0]}
                  y={parcel.centroid[1]}
                  fontSize={10 / zoomLevel}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--ink-muted)"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {parcel.commonArea ?? labelForPin(parcel.pin)}
                </text>
              ) : null
            )}
          </g>
        </g>
      </svg>

      {/* Board members will not think to scroll-zoom, so the controls are explicit. */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <Button
          size="icon-sm"
          variant="secondary"
          onClick={() => zoomBy(1.5)}
          aria-label="Zoom in"
          disabled={zoomLevel >= MAX_ZOOM}
        >
          <Plus />
        </Button>
        <Button
          size="icon-sm"
          variant="secondary"
          onClick={() => zoomBy(1 / 1.5)}
          aria-label="Zoom out"
          disabled={zoomLevel <= MIN_ZOOM}
        >
          <Minus />
        </Button>
        {recordBounds ? (
          <Button
            size="icon-sm"
            variant="secondary"
            onClick={() => frame(recordBounds)}
            aria-label="Frame the association's records"
            title="Frame the association's records"
          >
            <LocateFixed />
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="secondary"
          onClick={fitToView}
          aria-label="Fit every lot the county recorded"
          title="Fit every lot the county recorded"
        >
          <Maximize2 />
        </Button>
      </div>

      {placingEntity ? (
        <div className="panel panel-enter absolute top-2 left-2 flex items-center gap-2 px-2.5 py-1.5">
          <Crosshair className="text-survey size-4" aria-hidden="true" />
          <span className="text-13">
            Click the plat to place <span className="font-semibold">{placingEntity.name}</span>
          </span>
        </div>
      ) : null}

      <div className="text-ink-faint absolute bottom-2 left-2 font-mono text-[0.6875rem]">
        {Math.round(zoomLevel * 100)}%
      </div>
    </div>
  )
}

/** `20032 63001` reads as `63001` on the drawing. The full PIN is in the panel. */
function shortPin(pin: string): string {
  return pin.slice(6)
}

/* ---------------------------------------------------------------- parcel -- */

interface ParcelProps {
  parcel: ParcelPath
  fill: string
  lit: boolean
  selected: boolean
  hovered: boolean
  strokeWidth: number
  onSelect: (pin: string | null) => void
  onHover: (pin: string | null) => void
}

/*
  Memoised per lot. SVG hit testing is free and precise to the boundary, so
  there is no need for a Mapbox feature-state equivalent: React state plus a
  stroke change is enough at this scale.

  React reconciliation is the likelier bottleneck than the browser's SVG
  rendering, which is why this is memoised rather than inlined.
*/
const Parcel = memo(function Parcel({
  parcel,
  fill,
  lit,
  selected,
  hovered,
  strokeWidth,
  onSelect,
  onHover,
}: ParcelProps) {
  return (
    <path
      d={parcel.d}
      fill={lit ? fill : 'color-mix(in srgb, var(--ink) 2%, transparent)'}
      stroke={selected ? 'var(--survey)' : hovered ? 'var(--rule-strong)' : 'var(--rule-strong)'}
      strokeWidth={(selected ? 2.5 : hovered ? 1.8 : 1) * strokeWidth}
      opacity={lit ? 1 : 0.4}
      className="cursor-pointer transition-[fill] duration-[120ms]"
      onClick={(event) => {
        event.stopPropagation()
        onSelect(selected ? null : parcel.pin)
      }}
      onPointerEnter={() => onHover(parcel.pin)}
      onPointerLeave={() => onHover(null)}
    >
      <title>{parcel.commonArea ? `${parcel.commonArea}, ${parcel.pin}` : parcel.pin}</title>
    </path>
  )
})

/* ---------------------------------------------------------------- marker -- */

interface MarkerProps {
  marker: PlatMarker & { screen: [number, number] }
  selected: boolean
  zoom: number
  onSelect: (entityId: string) => void
}

const Marker = memo(function Marker({ marker, selected, zoom, onSelect }: MarkerProps) {
  const [x, y] = marker.screen
  const color = entityTypeColor(marker.entity.type)
  const radius = (selected ? 6 : marker.onDrawnLot ? 3.5 : 4.5) / zoom

  return (
    <g
      className={marker.onDrawnLot ? undefined : 'cursor-pointer'}
      pointerEvents={marker.onDrawnLot ? 'none' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(marker.entity.id)
      }}
    >
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={color}
        stroke="var(--paper-raised)"
        strokeWidth={1.5 / zoom}
      />
      {selected ? (
        <circle
          cx={x}
          cy={y}
          r={radius * 2.2}
          fill="none"
          stroke={color}
          strokeWidth={1 / zoom}
          opacity={0.6}
        />
      ) : null}
      <title>
        {marker.entity.name}
        {marker.location.precision === 'derived' ? ` (${marker.location.explanation})` : ''}
      </title>
    </g>
  )
})

/** Exported for the panel, which shows the same short form beside the full PIN. */
export { shortPin }

/** Reads a lot number off a property record, for the panel heading. */
export function lotNumberOf(entity: Entity | undefined): string {
  return entity ? readString(entity.data.lotNumber) : ''
}
