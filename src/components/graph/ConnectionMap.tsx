import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  ClipboardList,
  FileText,
  Landmark,
  MapPin,
  Shapes,
  User,
  type LucideIcon,
} from 'lucide-react'

import { entityTypeColor } from '@/components/ui/badge'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType,
  type Relation,
} from '@/lib/data/types'
import { isCurrent, type ResolvedGraph } from '@/lib/insights'
import { relationColor } from '@/lib/relations/colors'
import { buildRecencyScale, compareByDate, type RecencyScale } from '@/lib/relations/recency'
import { cn } from '@/lib/utils'

/*
  The Connection Map.

  A focus record sits at the top. Everything directly connected to it is laid
  out beneath in a centred row, joined by a drawn line labelled with the
  relation as read from the focus record's end. A second ring shows what those
  neighbours connect to in turn, on a dashed line, so a two-step relationship
  ("the treasurer works for the landscaping vendor") is visible without
  clicking through.

  The layout is computed, not physics-simulated. A force-directed graph
  reshuffles every time it is opened, and a board member comparing two lots
  needs the same shape twice.
*/

const TYPE_ICON: Record<EntityType, LucideIcon> = {
  person: User,
  property: MapPin,
  business: Building2,
  association: Landmark,
  asset: Shapes,
  record: ClipboardList,
  document: FileText,
}

const CARD_WIDTH = 152
const CARD_HEIGHT = 126
const COLUMN_GAP = 20
const ROW_GAP = 64
const FOCUS_Y = 20
const PADDING_X = 24

/** Beyond this the second ring stops being readable and starts being noise. */
const SECOND_RING_LIMIT = 8

export interface MapNode {
  entity: Entity
  /** The relation as read from the node one step closer to the focus. */
  relationLabel: string
  /** Which kind of connection this is, for the thread's colour. */
  relationKey: string
  /** The row itself, so the thread can be dated and ordered without a lookup. */
  relation: Relation
  /** False when the relation has ended: drawn faded, like the history divider. */
  current: boolean
  ring: 1 | 2
  /** Ring 2 nodes hang off a ring 1 node. */
  parentId: string
}

export interface ConnectionMapProps {
  graph: ResolvedGraph
  focus: Entity
  /** Types the reader has switched off. */
  hiddenTypes: Set<EntityType>
  /** Grade the threads by how recent each connection is. */
  gradeByAge?: boolean
  onFocusChange: (entity: Entity) => void
}

interface Placement {
  x: number
  y: number
}

export function ConnectionMap({
  graph,
  focus,
  hiddenTypes,
  gradeByAge = false,
  onFocusChange,
}: ConnectionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(960)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setViewportWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const { firstRing, secondRing } = useMemo(
    () => buildRings(graph, focus, hiddenTypes),
    [graph, focus, hiddenTypes]
  )

  const layout = useMemo(
    () => layoutRings(firstRing, secondRing, viewportWidth),
    [firstRing, secondRing, viewportWidth]
  )

  const nodes = useMemo(() => [...firstRing, ...secondRing], [firstRing, secondRing])

  const scales = useMemo(() => buildFanScales(nodes), [nodes])

  return (
    <div ref={containerRef} className="w-full overflow-x-auto">
      <div
        className="relative mx-auto"
        style={{ width: layout.width, height: layout.height, minWidth: layout.width }}
      >
        {/* Lines are drawn behind the cards, in one SVG, so nothing overlaps a
            card's text. */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {nodes.map((node) => {
            const to = layout.placements.get(node.entity.id)
            const from =
              node.ring === 1 ? layout.focus : layout.placements.get(node.parentId)
            if (!to || !from) return null

            /*
              Colour says what kind of connection this is, and it is the same
              colour the plat draws it in. Brightness says how recent it is,
              within this card's own fan. Ended connections are pulled back
              further still, because "this used to be true" should never be the
              loudest thing on the map.
            */
            const strength = gradeByAge
              ? (scales.get(node.parentId)?.strengthOf(node.relation.id) ?? 1)
              : 1

            return (
              <path
                key={`edge-${node.entity.id}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={relationColor(node.relationKey)}
                strokeWidth={1.5}
                strokeDasharray={node.ring === 2 ? '3 3' : undefined}
                opacity={node.current ? strength : Math.max(0.22, strength * 0.6)}
              />
            )
          })}
        </svg>

        <MapCard
          entity={focus}
          placement={layout.focus}
          isFocus
          onSelect={() => undefined}
        />

        {nodes.map((node) => {
          const placement = layout.placements.get(node.entity.id)
          if (!placement) return null
          return (
            <MapCard
              key={node.entity.id}
              entity={node.entity}
              placement={placement}
              relationLabel={node.relationLabel}
              dimmed={!node.current}
              secondary={node.ring === 2}
              onSelect={() => onFocusChange(node.entity)}
            />
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ card -- */

interface MapCardProps {
  entity: Entity
  placement: Placement
  relationLabel?: string
  isFocus?: boolean
  dimmed?: boolean
  secondary?: boolean
  onSelect: () => void
}

function MapCard({
  entity,
  placement,
  relationLabel,
  isFocus = false,
  dimmed = false,
  secondary = false,
  onSelect,
}: MapCardProps) {
  const color = entityTypeColor(entity.type)
  const Icon = TYPE_ICON[entity.type]

  const content = (
    <>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
        aria-hidden="true"
      >
        <Icon className="size-3.5" />
      </span>

      <span className="text-ink line-clamp-2 text-center text-xs leading-tight font-semibold">
        {entity.name}
      </span>

      <span
        className="rounded-[3px] px-1 py-px text-[0.625rem] font-semibold"
        style={{
          color,
          backgroundColor: `color-mix(in srgb, ${color} calc(var(--type-tint-opacity) * 100%), transparent)`,
        }}
      >
        {ENTITY_TYPE_LABELS[entity.type].singular}
      </span>

      {relationLabel ? (
        <span className="text-ink-faint truncate font-mono text-[0.625rem] tracking-[0.06em] uppercase">
          {relationLabel}
        </span>
      ) : null}
    </>
  )

  const style: React.CSSProperties = {
    left: placement.x - CARD_WIDTH / 2,
    top: placement.y - CARD_HEIGHT / 2,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderColor: isFocus ? color : `color-mix(in srgb, ${color} 45%, var(--rule))`,
    ...(isFocus
      ? { boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }
      : undefined),
  }

  const className = cn(
    'bg-paper-raised absolute flex flex-col items-center justify-center gap-1 rounded-[6px] border px-2 py-2 text-center transition-colors duration-[120ms]',
    isFocus ? 'border-2' : 'hover:border-rule-strong cursor-pointer',
    secondary && 'opacity-90',
    dimmed && 'opacity-60'
  )

  if (isFocus) {
    return (
      <div className={className} style={style} aria-current="true">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={className}
      style={style}
      aria-label={`Centre the map on ${entity.name}, ${ENTITY_TYPE_LABELS[entity.type].singular}${
        relationLabel ? `, ${relationLabel}` : ''
      }`}
    >
      {content}
    </button>
  )
}

/* ---------------------------------------------------------------- layout -- */

function edgePath(from: Placement, to: Placement): string {
  const startY = from.y + CARD_HEIGHT / 2
  const endY = to.y - CARD_HEIGHT / 2
  const midY = startY + (endY - startY) / 2
  return `M ${from.x} ${startY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${endY}`
}

interface Layout {
  width: number
  height: number
  focus: Placement
  placements: Map<string, Placement>
}

export function layoutRings(
  firstRing: MapNode[],
  secondRing: MapNode[],
  viewportWidth: number
): Layout {
  const step = CARD_WIDTH + COLUMN_GAP
  const usable = Math.max(viewportWidth, CARD_WIDTH + PADDING_X * 2)
  const perRow = Math.max(1, Math.floor((usable - PADDING_X * 2) / step))

  const firstRows = chunk(firstRing, perRow)
  const secondRows = chunk(secondRing, perRow)

  // Wide enough for the busiest row, and never narrower than the viewport.
  const widestRow = Math.max(1, ...firstRows.map((row) => row.length), ...secondRows.map((row) => row.length))
  const width = Math.max(usable, widestRow * step - COLUMN_GAP + PADDING_X * 2)
  const centerX = width / 2

  const placements = new Map<string, Placement>()

  const focus: Placement = { x: centerX, y: FOCUS_Y + CARD_HEIGHT / 2 }
  let y = focus.y + CARD_HEIGHT / 2 + ROW_GAP + CARD_HEIGHT / 2

  const placeRow = (row: MapNode[], rowY: number) => {
    const rowWidth = row.length * step - COLUMN_GAP
    const startX = centerX - rowWidth / 2 + CARD_WIDTH / 2
    row.forEach((node, index) => {
      placements.set(node.entity.id, { x: startX + index * step, y: rowY })
    })
  }

  for (const row of firstRows) {
    placeRow(row, y)
    y += CARD_HEIGHT + ROW_GAP
  }

  for (const row of secondRows) {
    placeRow(row, y)
    y += CARD_HEIGHT + ROW_GAP
  }

  const height = Math.max(y - ROW_GAP + CARD_HEIGHT / 2 + 16, FOCUS_Y + CARD_HEIGHT + 40)

  return { width, height, focus, placements }
}

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < list.length; index += size) {
    rows.push(list.slice(index, index + size))
  }
  return rows
}

/* ------------------------------------------------------------ fan scales -- */

/**
 * One recency ramp per fan, a fan being everything hanging off one card.
 *
 * Not one ramp for the whole map, which is the obvious thing and the wrong one.
 * A reader looking at eight lots under an association is asking which of those
 * eight joined last, and a single map-wide ramp answers a question nobody
 * asked: it spends the whole range on the gap between the oldest thread
 * anywhere on screen and the newest anywhere on screen. When the newest happens
 * to be the focus record's own address, every one of the eight lands on the
 * dim end and they are indistinguishable from each other.
 *
 * The cost is that brightness compares within a fan and not across two of them,
 * which the legend says out loud. That is the right trade: siblings are what
 * sit next to each other and invite comparison.
 */
export function buildFanScales(nodes: readonly MapNode[]): Map<string, RecencyScale> {
  const byParent = new Map<string, MapNode[]>()

  for (const node of nodes) {
    const group = byParent.get(node.parentId)
    if (group) group.push(node)
    else byParent.set(node.parentId, [node])
  }

  const scales = new Map<string, RecencyScale>()
  for (const [parentId, group] of byParent) {
    scales.set(
      parentId,
      buildRecencyScale(group.map((node) => node.relation))
    )
  }
  return scales
}

/* ----------------------------------------------------------------- rings -- */

export function buildRings(
  graph: ResolvedGraph,
  focus: Entity,
  hiddenTypes: Set<EntityType>
): { firstRing: MapNode[]; secondRing: MapNode[] } {
  const visible = (entity: Entity) => entity.deletedAt === null && !hiddenTypes.has(entity.type)

  const firstRing: MapNode[] = []
  const seen = new Set<string>([focus.id])

  for (const relation of graph.relationsFor.get(focus.id) ?? []) {
    const type = graph.typeById.get(relation.relationTypeId)
    if (!type) continue

    const outgoing = relation.fromEntityId === focus.id
    const otherId = outgoing ? relation.toEntityId : relation.fromEntityId
    const other = graph.byId.get(otherId)
    if (!other || seen.has(other.id) || !visible(other)) continue

    seen.add(other.id)
    firstRing.push({
      entity: other,
      // Bidirectionality is a read concern: one row, read from this end.
      relationLabel: outgoing ? type.label : type.reverseLabel,
      relationKey: type.key,
      relation,
      current: isCurrent(relation),
      ring: 1,
      parentId: focus.id,
    })
  }

  /*
    Ended connections last, then oldest to newest, then by name.

    Chronological order is half of the answer to "which of these lots joined
    first". The other half is how bright the thread is, and the two agree:
    leftmost is oldest is faintest. Position is the easier of the two to compare
    across a wide row, so it carries the ordering and brightness carries the
    size of the gaps. Undated connections sort to the end of their group, which
    is where compareByDate puts them.
  */
  firstRing.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      compareByDate(a.relation, b.relation) ||
      a.entity.name.localeCompare(b.entity.name)
  )

  const secondRing: MapNode[] = []

  for (const parent of firstRing) {
    if (secondRing.length >= SECOND_RING_LIMIT) break

    for (const relation of graph.relationsFor.get(parent.entity.id) ?? []) {
      if (secondRing.length >= SECOND_RING_LIMIT) break

      const type = graph.typeById.get(relation.relationTypeId)
      if (!type) continue

      const outgoing = relation.fromEntityId === parent.entity.id
      const otherId = outgoing ? relation.toEntityId : relation.fromEntityId
      const other = graph.byId.get(otherId)
      if (!other || seen.has(other.id) || !visible(other)) continue

      seen.add(other.id)
      secondRing.push({
        entity: other,
        relationLabel: outgoing ? type.label : type.reverseLabel,
        relationKey: type.key,
        relation,
        current: isCurrent(relation),
        ring: 2,
        parentId: parent.entity.id,
      })
    }
  }

  // The same order within each parent's group, so a row of eight member lots
  // reads left to right in the order they joined.
  secondRing.sort(
    (a, b) =>
      a.parentId.localeCompare(b.parentId) ||
      Number(b.current) - Number(a.current) ||
      compareByDate(a.relation, b.relation) ||
      a.entity.name.localeCompare(b.entity.name)
  )

  return { firstRing, secondRing }
}

/* ---------------------------------------------------------- type filters -- */

export interface TypeFilterBarProps {
  counts: Record<EntityType, number>
  hiddenTypes: Set<EntityType>
  onToggle: (type: EntityType) => void
}

/** The chip row from the top right of the map: one per type, with a count. */
export function TypeFilterBar({ counts, hiddenTypes, onToggle }: TypeFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ENTITY_TYPES.filter((type) => counts[type] > 0).map((type) => {
        const color = entityTypeColor(type)
        const hidden = hiddenTypes.has(type)
        const Icon = TYPE_ICON[type]

        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={!hidden}
            className={cn(
              'flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-xs font-semibold transition-colors duration-[120ms]',
              hidden ? 'border-rule text-ink-faint' : ''
            )}
            style={
              hidden
                ? undefined
                : {
                    color,
                    borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
                    backgroundColor: `color-mix(in srgb, ${color} calc(var(--type-tint-opacity) * 100%), transparent)`,
                  }
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {ENTITY_TYPE_LABELS[type].plural}
            <span className="font-mono text-[0.6875rem]">{counts[type]}</span>
          </button>
        )
      })}
    </div>
  )
}

