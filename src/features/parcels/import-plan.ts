import type { DataProvider, Entity, Relation, RelationType } from '@/lib/data/types'
import { classifyOwner, findOwnerMatch, toDisplayName, type OwnerKind } from '@/lib/parcels/owner'
import { readString } from '@/lib/format'
import { normalizePin } from '@/lib/parcels/pin'
import type { ParcelRecord } from '@/lib/parcels/types'

/*
  The import plan.

  Step 3 of the parcel import is the important one, and all of its decisions
  are made here as pure functions over the parcels and the records already in
  the system. The screen renders the plan and lets the user override any row;
  it does not compute anything itself.

  Nothing is written until applyImportPlan runs, and everything it writes goes
  through the DataProvider, so the whole import is audited exactly like a hand
  edit and shows up in Activity as one batch.
*/

export type PropertyAction = 'create_property' | 'update_property' | 'skip'
export type OwnerAction = 'create_owner' | 'link_owner' | 'skip_owner'

export interface FieldChange {
  field: string
  label: string
  from: string | null
  to: string | null
}

export interface PlanRow {
  /** Stable key for React and for row overrides. */
  key: string
  parcel: ParcelRecord
  selected: boolean

  propertyAction: PropertyAction
  existingProperty: Entity | null
  /** Populated only when propertyAction is update_property. */
  changes: FieldChange[]

  ownerAction: OwnerAction
  ownerMatch: Entity | null
  ownerMatchConfidence: 'exact' | 'normalized' | null
  ownerKind: OwnerKind
  ownerDisplayName: string
  /** True when the owner is already recorded as owning this exact lot. */
  ownershipAlreadyRecorded: boolean
}

/** Parcel field to property `data` key, with the label the diff shows. */
const FIELD_MAP: { source: keyof ParcelRecord; field: string; label: string }[] = [
  { source: 'situsAddress', field: 'situsAddress', label: 'Situs address' },
  // Zoning district only. Property use is what is actually there and the
  // county roll does not know it, so the import must never touch it.
  { source: 'zoningDistrict', field: 'zoning', label: 'Zoning district' },
  { source: 'acreage', field: 'acreage', label: 'Acreage' },
  { source: 'assessedValue', field: 'assessedValue', label: 'Assessed value' },
  { source: 'assessedYear', field: 'assessedYear', label: 'Assessed year' },
]

function asComparable(value: unknown): string | null {
  const text = readString(value)
  return text === '' ? null : text
}

export function diffParcelAgainstProperty(parcel: ParcelRecord, property: Entity): FieldChange[] {
  const changes: FieldChange[] = []

  for (const mapping of FIELD_MAP) {
    const to = asComparable(parcel[mapping.source])
    const from = asComparable(property.data[mapping.field])
    if (from !== to) {
      changes.push({ field: mapping.field, label: mapping.label, from, to })
    }
  }

  return changes
}

/** The `data` patch an import writes onto a property. */
export function parcelToPropertyData(
  parcel: ParcelRecord,
  existing: Entity | null
): Record<string, unknown> {
  const base = existing ? { ...existing.data } : {}

  for (const mapping of FIELD_MAP) {
    base[mapping.field] = parcel[mapping.source]
  }

  base.pin = normalizePin(parcel.pin)
  base.parcelSource = 'imported'

  return base
}

export interface BuildPlanOptions {
  parcels: ParcelRecord[]
  entities: Entity[]
  /** Existing relations, so the plan does not propose ownership twice. */
  relations?: Relation[]
  relationTypes?: RelationType[]
}

export function buildImportPlan({
  parcels,
  entities,
  relations = [],
  relationTypes = [],
}: BuildPlanOptions): PlanRow[] {
  const active = entities.filter((entity) => entity.deletedAt === null)

  const ownsTypeIds = new Set(
    relationTypes.filter((type) => type.key === 'owns').map((type) => type.id)
  )

  /** `${ownerId}->${propertyId}` for every current ownership already stored. */
  const recordedOwnership = new Set(
    relations
      .filter(
        (relation) =>
          relation.deletedAt === null &&
          relation.endDate === null &&
          ownsTypeIds.has(relation.relationTypeId)
      )
      .map((relation) => `${relation.fromEntityId}->${relation.toEntityId}`)
  )

  const propertiesByPin = new Map<string, Entity>()
  for (const entity of active) {
    if (entity.type !== 'property') continue
    const pin = entity.data.pin
    if (typeof pin === 'string' && pin.trim() !== '') {
      propertiesByPin.set(normalizePin(pin), entity)
    }
  }

  const ownerCandidates = active.filter(
    (entity) => entity.type === 'person' || entity.type === 'business'
  )

  return parcels.map((parcel, index) => {
    const pin = normalizePin(parcel.pin)
    const existingProperty = propertiesByPin.get(pin) ?? null

    const changes = existingProperty ? diffParcelAgainstProperty(parcel, existingProperty) : []

    const ownerKind = classifyOwner(parcel.ownerName)
    const ownerDisplayName = toDisplayName(parcel.ownerName, ownerKind)
    const match = findOwnerMatch(parcel.ownerName, ownerCandidates)

    // If this owner is already recorded as owning this lot, the row still
    // updates the parcel fields but proposes no second ownership relation.
    const ownershipAlreadyRecorded = Boolean(
      match && existingProperty && recordedOwnership.has(`${match.candidate.id}->${existingProperty.id}`)
    )

    return {
      key: `${pin}-${index}`,
      parcel,
      selected: true,
      propertyAction: existingProperty ? 'update_property' : 'create_property',
      existingProperty,
      changes,
      ownerAction: ownershipAlreadyRecorded ? 'skip_owner' : match ? 'link_owner' : 'create_owner',
      ownerMatch: match?.candidate ?? null,
      ownerMatchConfidence: match?.confidence ?? null,
      ownerKind,
      ownerDisplayName,
      ownershipAlreadyRecorded,
    }
  })
}

/* ---------------------------------------------------------------- summary -- */

export interface PlanSummary {
  propertiesToCreate: number
  propertiesToUpdate: number
  ownersToCreate: number
  ownersToLink: number
  ownershipRelations: number
  skipped: number
  /** Rows selected but with an update that would change nothing. */
  noChangeUpdates: number
}

export function summarizePlan(rows: PlanRow[]): PlanSummary {
  const summary: PlanSummary = {
    propertiesToCreate: 0,
    propertiesToUpdate: 0,
    ownersToCreate: 0,
    ownersToLink: 0,
    ownershipRelations: 0,
    skipped: 0,
    noChangeUpdates: 0,
  }

  /** Two parcels can name the same new owner. That is one create, not two. */
  const newOwnerNames = new Set<string>()

  for (const row of rows) {
    if (!row.selected || row.propertyAction === 'skip') {
      summary.skipped += 1
      continue
    }

    if (row.propertyAction === 'create_property') summary.propertiesToCreate += 1
    if (row.propertyAction === 'update_property') {
      if (row.changes.length === 0) summary.noChangeUpdates += 1
      else summary.propertiesToUpdate += 1
    }

    if (row.ownerAction === 'create_owner') {
      newOwnerNames.add(row.ownerDisplayName.toLowerCase())
      summary.ownershipRelations += 1
    }
    if (row.ownerAction === 'link_owner') {
      summary.ownersToLink += 1
      summary.ownershipRelations += 1
    }
  }

  summary.ownersToCreate = newOwnerNames.size
  return summary
}

/* ------------------------------------------------------------------ apply -- */

export interface ApplyResult {
  batchId: string
  propertiesCreated: number
  propertiesUpdated: number
  ownersCreated: number
  ownersLinked: number
  relationsCreated: number
  skipped: number
}

export interface ApplyOptions {
  rows: PlanRow[]
  provider: DataProvider
  /** Relation type id for ownership. Read from the provider by the caller. */
  ownsRelationTypeId: string
  /** ISO date the ownership relation starts. Defaults to today. */
  startDate?: string
}

/**
 * Performs the import. Every write goes through the provider, inside one
 * batch, so the result screen can link straight to this import's own rows in
 * Activity.
 */
export async function applyImportPlan({
  rows,
  provider,
  ownsRelationTypeId,
  startDate,
}: ApplyOptions): Promise<ApplyResult> {
  const effectiveStart = startDate ?? new Date().toISOString().slice(0, 10)

  const { batchId, result } = await provider.runBatch(async () => {
    const counts = {
      propertiesCreated: 0,
      propertiesUpdated: 0,
      ownersCreated: 0,
      ownersLinked: 0,
      relationsCreated: 0,
      skipped: 0,
    }

    /** Owners created during this run, so a repeated name is created once. */
    const createdOwners = new Map<string, Entity>()

    for (const row of rows) {
      if (!row.selected || row.propertyAction === 'skip') {
        counts.skipped += 1
        continue
      }

      let property = row.existingProperty

      if (row.propertyAction === 'create_property') {
        property = await provider.createEntity({
          type: 'property',
          name: row.parcel.situsAddress,
          data: parcelToPropertyData(row.parcel, null),
        })
        counts.propertiesCreated += 1
      } else if (property && row.changes.length > 0) {
        property = await provider.updateEntity(property.id, {
          data: parcelToPropertyData(row.parcel, property),
        })
        counts.propertiesUpdated += 1
      }

      if (!property) continue
      if (row.ownerAction === 'skip_owner') continue

      let owner = row.ownerMatch

      if (row.ownerAction === 'create_owner') {
        const key = row.ownerDisplayName.toLowerCase()
        const alreadyCreated = createdOwners.get(key)

        if (alreadyCreated) {
          owner = alreadyCreated
        } else {
          owner = await provider.createEntity({
            type: row.ownerKind,
            name: row.ownerDisplayName,
            data: {
              mailingAddress: row.parcel.ownerMailingAddress,
              // Recorded so it is obvious where this record came from.
              parcelSource: 'imported',
              ...(row.ownerKind === 'person'
                ? { email: null, phone: null, householdRole: 'owner' }
                : { businessCategory: 'property_owner', stateFilingNumber: null }),
              notes: '',
            },
          })
          createdOwners.set(key, owner)
          counts.ownersCreated += 1
        }
      } else if (row.ownerAction === 'link_owner') {
        counts.ownersLinked += 1
      }

      if (!owner) continue

      await provider.createRelation({
        relationTypeId: ownsRelationTypeId,
        fromEntityId: owner.id,
        toEntityId: property.id,
        startDate: effectiveStart,
        attributes: { source: 'parcel import', ownerOfRecord: row.parcel.ownerName },
      })
      counts.relationsCreated += 1
    }

    return counts
  })

  return { batchId, ...result }
}

/* ---------------------------------------------------------------- parsing -- */

/**
 * Pulls PINs out of a pasted list or a CSV. Accepts one per line or a CSV
 * whose first column is the PIN, and tolerates a header row.
 *
 * Split on newlines and commas would break the spaced PIN form, so lines are
 * split on commas only and the first cell is taken.
 */
export function parsePinList(input: string): string[] {
  const pins: string[] = []
  const seen = new Set<string>()

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue

    const firstCell = (line.split(',')[0] ?? '').trim().replace(/^"|"$/g, '')
    if (firstCell === '') continue

    // Skip a header row rather than reporting it as a PIN that was not found.
    if (/^pin$|^parcel/i.test(firstCell)) continue

    const pin = normalizePin(firstCell)
    if (seen.has(pin)) continue
    seen.add(pin)
    pins.push(pin)
  }

  return pins
}
