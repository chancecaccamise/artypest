import { formatFieldName } from '@/lib/format'
import type {
  AuditEntry,
  Entity,
  EntityType,
  ReviewIndex,
  ReviewState,
  ReviewStatus,
} from '@/lib/data/types'
import { ENTITY_TYPES } from '@/lib/data/types'

/*
  The hand mark, worked out rather than stored.

  A record carries `reviewedAt`: the moment a person last read it and said it
  was right. The state is that timestamp compared against the last time the
  county roll wrote to the same record. Storing the state itself would mean
  every parcel import had to remember to invalidate it, and an import that
  forgets leaves a green tick on a record that has since changed underneath it.

  Kept as pure functions over rows so the rules can be tested without a
  provider, and so the Postgres version, which is a view over `entities` and
  `audit_entries`, can be checked against the same cases.
*/

/** What a state is called in front of a board member. */
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  unchecked: 'Not checked',
  checked: 'Checked',
  recheck: 'Recheck',
}

/** Reads in a sentence: "Show records that are ...". */
export const REVIEW_FILTER_LABELS: Record<ReviewState, string> = {
  unchecked: 'Not checked yet',
  checked: 'Checked by hand',
  recheck: 'Needs a recheck',
}

/**
 * The last moment an import wrote to each record, keyed by record id.
 *
 * One pass over the whole audit log. Relation rows are deliberately included:
 * an import that attaches an owner to a lot has changed what that lot means,
 * even though no field on the lot moved.
 */
export function lastImportByRecord(entries: readonly AuditEntry[]): Map<string, string> {
  const latest = new Map<string, string>()

  for (const entry of entries) {
    if (entry.source !== 'import') continue
    const seen = latest.get(entry.recordId)
    if (seen === undefined || entry.changedAt > seen) {
      latest.set(entry.recordId, entry.changedAt)
    }
  }

  return latest
}

/**
 * Field names an import has written to this record since `since`, in the order
 * they were changed, without duplicates. What the recheck tooltip names.
 *
 * Inclusive of `since` itself, to match reviewStateOf: a row that made a record
 * stale must be one the reader can be told about, or the tooltip says a recheck
 * is needed and cannot say what for.
 */
export function fieldsChangedSince(
  entries: readonly AuditEntry[],
  recordId: string,
  since: string
): string[] {
  const fields: string[] = []

  for (const entry of entries) {
    if (entry.recordId !== recordId) continue
    if (entry.source !== 'import') continue
    if (entry.changedAt < since) continue

    const label = entry.fieldName === null ? 'the record' : formatFieldName(entry.fieldName)
    if (!fields.includes(label)) fields.push(label)
  }

  return fields
}

/**
 * One record's hand-mark state.
 *
 * `lastImportAt` is when the county roll last wrote to it, or null if it never
 * has.
 *
 * A tie counts as needing a recheck. Two writes stamped the same millisecond
 * carry no evidence of which came first, and of the two ways to be wrong, a
 * green tick on a record the county has since rewritten is the one that costs
 * something: it is a claim the association did not make. Being told to look
 * again at a record that was fine costs a click.
 */
export function reviewStateOf(entity: Entity, lastImportAt: string | null): ReviewState {
  if (entity.reviewedAt === null) return 'unchecked'
  if (lastImportAt !== null && lastImportAt >= entity.reviewedAt) return 'recheck'
  return 'checked'
}

export function reviewStatusOf(
  entity: Entity,
  lastImportAt: string | null,
  entries: readonly AuditEntry[] = []
): ReviewStatus {
  const state = reviewStateOf(entity, lastImportAt)

  return {
    entityId: entity.id,
    state,
    reviewedAt: entity.reviewedAt,
    reviewedBy: entity.reviewedBy,
    changedSince:
      state === 'recheck' && entity.reviewedAt !== null
        ? fieldsChangedSince(entries, entity.id, entity.reviewedAt)
        : [],
  }
}

function emptyCounts(): Record<EntityType, number> {
  return Object.fromEntries(ENTITY_TYPES.map((type) => [type, 0])) as Record<EntityType, number>
}

/**
 * Every checked record, with its state, plus the per-type counts the progress
 * meter needs.
 *
 * Records that have never been checked are left out on purpose. See ReviewIndex.
 */
export function buildReviewIndex(
  entities: readonly Entity[],
  entries: readonly AuditEntry[]
): ReviewIndex {
  const lastImport = lastImportByRecord(entries)
  const byEntity = new Map<string, ReviewStatus>()
  const checkedByType = emptyCounts()
  const recheckByType = emptyCounts()

  for (const entity of entities) {
    if (entity.reviewedAt === null) continue

    const status = reviewStatusOf(entity, lastImport.get(entity.id) ?? null, entries)
    byEntity.set(entity.id, status)

    // Counted against the active working set, which is what the meter is a
    // fraction of. An archived lot is neither work to do nor work done.
    if (entity.deletedAt !== null || entity.archivedAt !== null) continue
    if (status.state === 'checked') checkedByType[entity.type] += 1
    else if (status.state === 'recheck') recheckByType[entity.type] += 1
  }

  return { byEntity, checkedByType, recheckByType }
}

/** The state to render for a record, given an index that may not hold it. */
export function stateFor(index: ReviewIndex | undefined, entityId: string): ReviewState {
  return index?.byEntity.get(entityId)?.state ?? 'unchecked'
}
