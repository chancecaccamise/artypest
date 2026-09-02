import type { ActivityEntry, EntityType } from '@/lib/data/types'
import { formatFieldName } from '@/lib/format'

/*
  The running tab of what this reader has done.

  Built from the audit log rather than from a store of its own. The log already
  records every write with a timestamp, an actor, and a source; a second copy
  kept alongside it would be a second copy that can disagree, and it would be
  the copy that is wrong, because it is the one nothing else writes to.

  Reading it back means turning rows into moves. A save that changed six fields
  is six rows and one thing the reader did, and a work log that lists it six
  times is a work log they stop reading.
*/

export type WorkLogKind =
  | 'created'
  | 'checked'
  | 'unchecked'
  | 'edited'
  | 'connected'
  | 'disconnected'
  | 'archived'
  | 'restored'
  | 'removed'
  | 'imported'

export interface WorkLogEntry {
  /** Stable across refetches, so the list does not re-key while it is read. */
  key: string
  at: string
  kind: WorkLogKind
  entityId: string | null
  entityName: string | null
  entityType: EntityType | null
  /** Field labels, for `edited`. Already humanized. */
  fields: string[]
  /** Audit rows behind this move. What an import batch reports as its size. */
  rowCount: number
  batchId: string | null
}

/** How the panel says it, in front of a board member. */
export const KIND_VERB: Record<WorkLogKind, string> = {
  created: 'Added',
  checked: 'Checked',
  unchecked: 'Cleared the check on',
  edited: 'Changed',
  connected: 'Connected',
  disconnected: 'Disconnected',
  archived: 'Archived',
  restored: 'Restored',
  removed: 'Removed',
  imported: 'Imported',
}

/*
  Only these count as work done to a record. Everything else the log records is
  bookkeeping the reader did not choose to do.
*/
function kindOf(rows: ActivityEntry[]): WorkLogKind {
  const fields = new Set(rows.map((row) => row.fieldName))
  const relation = rows.some((row) => row.tableName === 'relations')

  if (rows.some((row) => row.action === 'insert')) return relation ? 'connected' : 'created'
  if (relation && rows.some((row) => row.action === 'delete')) return 'disconnected'

  if (fields.has('deletedAt')) {
    const row = rows.find((candidate) => candidate.fieldName === 'deletedAt')
    return row?.newValue === null ? 'restored' : 'removed'
  }

  if (fields.has('archivedAt')) {
    const row = rows.find((candidate) => candidate.fieldName === 'archivedAt')
    return row?.newValue === null ? 'restored' : 'archived'
  }

  /*
    A hand edit stamps the check as well as changing the fields, so a save that
    did both is reported as the edit. "Changed zoning" is what the reader did;
    "checked" is the consequence, and saying both would double the list.
  */
  const edited = rows.filter(
    (row) => row.action === 'update' && row.fieldName !== null && row.fieldName !== 'reviewedAt'
  )
  if (edited.length > 0) return 'edited'

  const check = rows.find((row) => row.fieldName === 'reviewedAt')
  if (check) return check.newValue === null ? 'unchecked' : 'checked'

  return 'edited'
}

function fieldsOf(rows: ActivityEntry[]): string[] {
  const labels: string[] = []
  for (const row of rows) {
    if (row.action !== 'update' || row.fieldName === null) continue
    if (row.fieldName === 'reviewedAt') continue
    const label = formatFieldName(row.fieldName)
    if (!labels.includes(label)) labels.push(label)
  }
  return labels
}

function newest(rows: ActivityEntry[]): string {
  return rows.reduce((latest, row) => (row.changedAt > latest ? row.changedAt : latest), '')
}

/**
 * Audit rows, newest first, folded into the moves that produced them.
 *
 * Hand rows group by record and instant: one save writes one row per changed
 * field, all stamped with the same moment, in both this provider and Postgres,
 * where `now()` is fixed for the transaction. Import rows group by batch
 * instead, so a four-hundred-lot import is one line rather than four hundred.
 */
export function buildWorkLog(entries: readonly ActivityEntry[]): WorkLogEntry[] {
  const groups = new Map<string, ActivityEntry[]>()

  for (const entry of entries) {
    const key =
      entry.source === 'import'
        ? `import:${entry.batchId ?? entry.changedAt}`
        : `hand:${entry.recordId}:${entry.changedAt}`

    const rows = groups.get(key)
    if (rows) rows.push(entry)
    else groups.set(key, [entry])
  }

  const log: WorkLogEntry[] = []

  for (const [key, rows] of groups) {
    const first = rows[0]
    if (!first) continue

    const imported = first.source === 'import'
    // An import touched many records, so naming one of them would be a lie.
    const subject = imported
      ? { entityId: null, entityName: null, entityType: null }
      : { entityId: first.entityId, entityName: first.entityName, entityType: first.entityType }

    log.push({
      key,
      at: newest(rows),
      kind: imported ? 'imported' : kindOf(rows),
      ...subject,
      fields: imported ? [] : fieldsOf(rows),
      rowCount: rows.length,
      batchId: first.batchId,
    })
  }

  return log.sort((a, b) => b.at.localeCompare(a.at))
}

/** How many distinct records this session has touched. Imports are not counted. */
export function recordsTouched(log: readonly WorkLogEntry[]): number {
  return new Set(
    log.filter((entry) => entry.entityId !== null).map((entry) => entry.entityId)
  ).size
}

/** How many records this session has checked. The number the reader is chasing. */
export function recordsChecked(log: readonly WorkLogEntry[]): number {
  return new Set(
    log
      .filter((entry) => entry.entityId !== null)
      .filter((entry) => entry.kind === 'checked' || entry.kind === 'edited' || entry.kind === 'created')
      .map((entry) => entry.entityId)
  ).size
}

/** What one line of the log says after the verb. */
export function describeEntry(entry: WorkLogEntry): string {
  if (entry.kind === 'imported') {
    return `${String(entry.rowCount)} changes from the county roll`
  }
  if (entry.kind !== 'edited') return ''

  const [first, second] = entry.fields
  if (entry.fields.length === 0) return ''
  if (entry.fields.length === 1) return String(first).toLowerCase()
  if (entry.fields.length === 2) return `${String(first).toLowerCase()} and ${String(second).toLowerCase()}`
  return `${String(first).toLowerCase()} and ${String(entry.fields.length - 1)} other fields`
}

/** "1 record", "12 records". Board members read this, so it agrees with itself. */
export function recordCount(count: number): string {
  return `${count.toLocaleString()} record${count === 1 ? '' : 's'}`
}
