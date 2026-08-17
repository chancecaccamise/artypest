import type { Entity, ReferenceItem } from '@/lib/data/types'
import { readString } from '@/lib/format'
import {
  OCCUPANCY_LABELS,
  OCCUPANCY_SEGMENTS,
  classifyOccupancy,
  isCurrent,
  relationKey,
  type ResolvedGraph,
} from '@/lib/insights'

/*
  Thematic colouring for the plat. See docs/MAP-SPEC.md section 5.

  Renderer independent: this returns CSS colour strings and bucket metadata,
  and knows nothing about SVG. It feeds a Mapbox fill-color expression exactly
  as well as it feeds a `fill` attribute.

  A mode must reuse an answer the app already computes. `occupancy` calls the
  same classifier the dashboard bar uses, so a lot cannot be owner-occupied on
  one screen and a rental on another.
*/

export const THEMATIC_MODES = [
  'none',
  'occupancy',
  'completeness',
  'property_use',
  'zoning',
  'open_items',
] as const

export type ThematicMode = (typeof THEMATIC_MODES)[number]

export const THEMATIC_MODE_LABELS: Record<ThematicMode, string> = {
  none: 'No colouring',
  occupancy: 'Occupancy',
  completeness: 'Record completeness',
  property_use: 'Property use',
  zoning: 'Zoning district',
  open_items: 'Open items',
}

export interface LegendBucket {
  key: string
  label: string
  color: string
  count: number
}

export interface Theming {
  mode: ThematicMode
  /** The fill for one lot. Lots with no property record get the unknown fill. */
  colorForPin: (pin: string) => string
  /** Buckets in a fixed order, with counts. Empty buckets are still listed. */
  legend: LegendBucket[]
}

/** The plat's resting fill. Ink at low opacity reads as paper, not as data. */
const NEUTRAL = 'color-mix(in srgb, var(--ink) 6%, transparent)'
const UNKNOWN = 'color-mix(in srgb, var(--rule-strong) 22%, transparent)'

/** A token colour at the tint the plat uses, so fills never fight the linework. */
function tint(color: string, percent = 42): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

const OCCUPANCY_COLORS: Record<(typeof OCCUPANCY_SEGMENTS)[number], string> = {
  owner_occupied: 'var(--moss)',
  long_term_rental: 'var(--survey)',
  short_term_rental: 'var(--amber)',
  vacant_or_unknown: 'var(--rule-strong)',
}

const COMPLETENESS_BUCKETS = [
  { key: 'complete', label: 'Complete', color: 'var(--moss)' },
  { key: 'no_owner', label: 'No current owner', color: 'var(--amber)' },
  { key: 'no_pin', label: 'No parcel number', color: 'var(--survey)' },
  { key: 'neither', label: 'Neither on file', color: 'var(--oxblood)' },
] as const

const OPEN_ITEM_BUCKETS = [
  { key: 'none', label: 'No open items', color: 'var(--rule-strong)' },
  { key: 'one', label: 'One open item', color: 'var(--amber)' },
  { key: 'many', label: 'Two or more', color: 'var(--oxblood)' },
] as const

/**
 * A stable palette for reference-list modes.
 *
 * Deliberately the entity type colours reused rather than a generated scale:
 * six distinguishable hues already in the token set beats an interpolation
 * nobody chose. Values past the sixth share the last colour, and the legend
 * says so by listing them.
 */
const CATEGORICAL = [
  'var(--type-property)',
  'var(--type-person)',
  'var(--type-business)',
  'var(--type-association)',
  'var(--type-asset)',
  'var(--type-record)',
]

export interface ThemingInput {
  mode: ThematicMode
  graph: ResolvedGraph
  /** PIN to the property record on that lot. */
  propertyByPin: Map<string, Entity>
  /** Every PIN the plat can draw, so empty buckets can still be counted. */
  pins: string[]
  referenceItems: ReferenceItem[]
  today?: Date
}

export function buildTheming(input: ThemingInput): Theming {
  switch (input.mode) {
    case 'occupancy':
      return occupancyTheming(input)
    case 'completeness':
      return completenessTheming(input)
    case 'property_use':
      return referenceTheming(input, 'property_use', 'propertyUse')
    case 'zoning':
      return referenceTheming(input, 'zoning', 'zoning')
    case 'open_items':
      return openItemsTheming(input)
    case 'none':
      return {
        mode: 'none',
        colorForPin: () => NEUTRAL,
        legend: [],
      }
  }
}

/* -------------------------------------------------------------- occupancy -- */

function occupancyTheming({ graph, propertyByPin, pins, today }: ThemingInput): Theming {
  // classifyOccupancy is the rule the dashboard bar totals. Calling it here
  // rather than restating it is what keeps the two screens agreeing.
  const classify = (property: Entity) => classifyOccupancy(property, graph, today)

  const byPin = new Map<string, (typeof OCCUPANCY_SEGMENTS)[number]>()
  const counts = new Map<string, number>()

  for (const pin of pins) {
    const property = propertyByPin.get(pin)
    const segment = property ? classify(property) : 'vacant_or_unknown'
    byPin.set(pin, segment)
    counts.set(segment, (counts.get(segment) ?? 0) + 1)
  }

  return {
    mode: 'occupancy',
    colorForPin: (pin) => {
      const segment = byPin.get(pin)
      return segment ? tint(OCCUPANCY_COLORS[segment]) : UNKNOWN
    },
    legend: OCCUPANCY_SEGMENTS.map((segment) => ({
      key: segment,
      label: OCCUPANCY_LABELS[segment],
      color: OCCUPANCY_COLORS[segment],
      count: counts.get(segment) ?? 0,
    })),
  }
}

/* ----------------------------------------------------------- completeness -- */

function completenessTheming({ graph, propertyByPin, pins, today }: ThemingInput): Theming {
  const withOwner = new Set<string>()
  for (const relation of graph.relations) {
    if (!isCurrent(relation, today)) continue
    if (relationKey(relation, graph) !== 'owns') continue
    withOwner.add(relation.toEntityId)
  }

  const byPin = new Map<string, string>()
  const counts = new Map<string, number>()

  for (const pin of pins) {
    const property = propertyByPin.get(pin)
    const hasOwner = property ? withOwner.has(property.id) : false
    const hasPin = property ? readString(property.data.pin) !== '' : false

    const bucket =
      hasOwner && hasPin ? 'complete' : !hasOwner && !hasPin ? 'neither' : hasOwner ? 'no_pin' : 'no_owner'

    byPin.set(pin, bucket)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return {
    mode: 'completeness',
    colorForPin: (pin) => {
      const bucket = COMPLETENESS_BUCKETS.find((candidate) => candidate.key === byPin.get(pin))
      return bucket ? tint(bucket.color) : UNKNOWN
    },
    legend: COMPLETENESS_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      count: counts.get(bucket.key) ?? 0,
    })),
  }
}

/* -------------------------------------------------------- reference lists -- */

function referenceTheming(
  { propertyByPin, pins, referenceItems }: ThemingInput,
  list: 'property_use' | 'zoning',
  dataKey: 'propertyUse' | 'zoning'
): Theming {
  const items = referenceItems
    .filter((item) => item.list === list)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const colorByValue = new Map<string, string>()
  items.forEach((item, index) => {
    colorByValue.set(item.value, CATEGORICAL[index % CATEGORICAL.length] ?? CATEGORICAL[0] ?? '')
  })

  const counts = new Map<string, number>()
  const byPin = new Map<string, string>()

  for (const pin of pins) {
    const property = propertyByPin.get(pin)
    const value = property ? readString(property.data[dataKey]) : ''
    byPin.set(pin, value)
    if (value !== '') counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const notSet = pins.filter((pin) => byPin.get(pin) === '').length

  const legend: LegendBucket[] = items.map((item) => ({
    key: item.value,
    label: item.label,
    color: colorByValue.get(item.value) ?? UNKNOWN,
    count: counts.get(item.value) ?? 0,
  }))

  legend.push({ key: '', label: 'Not set', color: 'var(--rule-strong)', count: notSet })

  return {
    mode: list,
    colorForPin: (pin) => {
      const value = byPin.get(pin)
      if (!value) return UNKNOWN
      const color = colorByValue.get(value)
      return color ? tint(color) : UNKNOWN
    },
    legend,
  }
}

/* ------------------------------------------------------------- open items -- */

function openItemsTheming({ graph, propertyByPin, pins }: ThemingInput): Theming {
  const openByProperty = new Map<string, number>()

  for (const entity of graph.entities) {
    if (entity.type !== 'record') continue
    if (entity.deletedAt !== null || entity.archivedAt !== null) continue
    if (entity.data.status === 'closed') continue

    const propertyId = readString(entity.data.propertyId)
    if (propertyId === '') continue
    openByProperty.set(propertyId, (openByProperty.get(propertyId) ?? 0) + 1)
  }

  const byPin = new Map<string, string>()
  const counts = new Map<string, number>()

  for (const pin of pins) {
    const property = propertyByPin.get(pin)
    const open = property ? (openByProperty.get(property.id) ?? 0) : 0
    const bucket = open === 0 ? 'none' : open === 1 ? 'one' : 'many'
    byPin.set(pin, bucket)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return {
    mode: 'open_items',
    colorForPin: (pin) => {
      const bucket = OPEN_ITEM_BUCKETS.find((candidate) => candidate.key === byPin.get(pin))
      return bucket ? tint(bucket.color) : UNKNOWN
    },
    legend: OPEN_ITEM_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      count: counts.get(bucket.key) ?? 0,
    })),
  }
}
