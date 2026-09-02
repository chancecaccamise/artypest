import type { DataProvider, Entity, EntityType, Relation } from '@/lib/data/types'
import { formatMailingAddress } from '@/lib/parcels/types'

import type { OwnerGroup } from './reconcile'

/*
  Committing a reconciliation.

  Everything here runs inside one `runBatch`, so every record and every relation
  it writes carries the same batch id and the Activity feed can say "the
  reconciliation that produced these 11,499 records" rather than showing eleven
  thousand unrelated entries. That is also what makes it reviewable afterwards.

  Only `link` and `create` are ever applied. `review` and `skip` are left
  exactly as they were: the whole point of the split is that a human sees those.
*/

export interface ApplyOwnersOptions {
  provider: DataProvider
  groups: readonly OwnerGroup[]
  /** The `owns` relation type, looked up once by the caller. */
  ownsRelationTypeId: string
  /** Properties by id, so a relation can read the lot's own sale date. */
  propertiesById: ReadonlyMap<string, Entity>
  /** Reports progress, because this can be tens of thousands of writes. */
  onProgress?: (done: number, total: number) => void
}

export interface ApplyOwnersResult {
  batchId: string
  ownersCreated: number
  ownersLinked: number
  relationsCreated: number
  /** Relations that already existed, so nothing was written. */
  relationsSkipped: number
}

/** The county's owner name, exactly as filed, off a property record. */
function ownerRawOf(property: Entity | undefined): string {
  const raw = property?.data.countyOwnerRaw
  return typeof raw === 'string' ? raw : ''
}

/*
  The county's mailing address, however the record happens to carry it. A
  property reconciled from the harvest holds the formatted string; one that came
  through the parcel import holds the structured shape.
*/
function mailingAddressOf(property: Entity | undefined): string {
  const value = property?.data.mailingAddress ?? property?.data.ownerMailingAddress
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    return formatMailingAddress(value as Parameters<typeof formatMailingAddress>[0])
  }
  return ''
}

/**
 * The data a newly created owner carries, by kind.
 *
 * Each kind gets its own fields. An association filed with `businessCategory`
 * would carry a key its own form never shows and its schema does not know
 * about, which is how a record ends up with data nobody can see or edit.
 */
function dataFor(kind: EntityType, mailingAddress: string, raw: string): Record<string, unknown> {
  const shared = {
    mailingAddress,
    // Recorded so it is obvious where this record came from, and so a
    // reconciliation can be told from a record somebody typed.
    parcelSource: 'reconciled',
    // The county's string, kept verbatim beside the tidied name. It is what a
    // reader compares against the county viewer.
    countyOwnerRaw: raw,
    notes: '',
  }

  if (kind === 'person') {
    return { ...shared, email: null, phone: null, householdRole: 'owner' }
  }
  if (kind === 'association') {
    /*
      `associationType` is left unset on purpose. The county says a parcel is
      owned by a condominium association; it does not say whether that is a
      homeowners association or a property owners association, and guessing puts
      a wrong answer somewhere a human has to notice to correct.
    */
    return {
      ...shared,
      associationType: null,
      boardSeats: null,
      foundedYear: null,
      jurisdiction: null,
      meetingCadence: null,
    }
  }
  return { ...shared, businessCategory: 'property_owner', stateFilingNumber: null }
}

export async function applyOwnerPlan({
  provider,
  groups,
  ownsRelationTypeId,
  propertiesById,
  onProgress,
}: ApplyOwnersOptions): Promise<ApplyOwnersResult> {
  const actionable = groups.filter(
    (group) => group.verdict === 'link' || group.verdict === 'create'
  )

  /*
    Declared as an import. Reconciliation reads the county's owner strings, not
    a folder on somebody's desk, so the records it creates carry no hand mark.
  */
  const { batchId, result } = await provider.runBatch(async () => {
    const counts = { ownersCreated: 0, ownersLinked: 0, relationsCreated: 0, relationsSkipped: 0 }

    /*
      Read once, before anything is written. An owner holding 170 lots would
      otherwise re-read the relation list 170 times, and the list only grows as
      this loop runs.
    */
    const existing = await provider.listRelations()
    const seen = new Set(
      existing
        .filter((relation: Relation) => relation.deletedAt === null)
        .map((relation: Relation) => `${relation.fromEntityId}|${relation.toEntityId}`)
    )

    let done = 0
    for (const group of actionable) {
      let owner = group.match

      if (owner === null) {
        const sample = propertiesById.get(group.propertyIds[0] ?? '')
        owner = await provider.createEntity({
          type: group.parsed.kind,
          // The parsed, readable form: `Colin A. McRae` rather than
          // `MCRAE COLIN A`. The county's string is kept in the data.
          name: group.parsed.display,
          data: dataFor(group.parsed.kind, mailingAddressOf(sample), ownerRawOf(sample)),
        })
        counts.ownersCreated += 1
      } else {
        counts.ownersLinked += 1
      }

      for (const propertyId of group.propertyIds) {
        const key = `${owner.id}|${propertyId}`
        // Re-running a reconciliation must not double every relation it made
        // last time.
        if (seen.has(key)) {
          counts.relationsSkipped += 1
          continue
        }

        const property = propertiesById.get(propertyId)
        const lastSale = property?.data.lastSaleDate

        await provider.createRelation({
          relationTypeId: ownsRelationTypeId,
          fromEntityId: owner.id,
          toEntityId: propertyId,
          /*
            The county's last recorded transfer is when this ownership began, as
            closely as the roll can say. It also makes the plat's age grading
            work on ownership for free: the brightest thread is the lot that
            changed hands most recently.
          */
          startDate: typeof lastSale === 'string' ? lastSale : null,
          attributes: { source: 'county_roll' },
        })
        seen.add(key)
        counts.relationsCreated += 1
      }

      done += 1
      onProgress?.(done, actionable.length)
    }

    return counts
  }, 'import')

  return { batchId, ...result }
}
