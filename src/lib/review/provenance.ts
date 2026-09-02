import type { AuditEntry, AuditSource } from '@/lib/data/types'

/*
  Field-level provenance.

  The record mark answers "has anyone read this lot". This answers the next
  question, which is the one that actually settles an argument: of the eleven
  fields on this lot, which ones did we type and which ones came off the county
  roll? A zoning district the association corrected by hand and a zoning
  district the county last wrote in 2019 look identical in a field grid, and
  they are not the same claim.

  Read off the audit log rather than stored beside each value, because the log
  already records exactly this and a second copy of it would be a second copy
  that can disagree.
*/

/** Where a field's current value came from. `unknown` means nothing wrote it. */
export type FieldSource = AuditSource | 'unknown'

/**
 * The source of the most recent write to each field, keyed by the bare field
 * name: `zoning`, not `data.zoning`.
 *
 * `entries` may arrive in any order. The newest row per field wins, and ties
 * go to the row that appears later, which for an append-only log is the later
 * write.
 */
export function fieldSources(entries: readonly AuditEntry[]): Map<string, FieldSource> {
  const latest = new Map<string, { at: string; source: AuditSource }>()

  for (const entry of entries) {
    // Only field-level updates carry provenance. An insert row says the record
    // was created, not which of its fields anybody looked at.
    if (entry.action !== 'update' || entry.fieldName === null) continue
    if (entry.tableName !== 'entities') continue

    const field = entry.fieldName.startsWith('data.')
      ? entry.fieldName.slice(5)
      : entry.fieldName

    const seen = latest.get(field)
    if (seen === undefined || entry.changedAt >= seen.at) {
      latest.set(field, { at: entry.changedAt, source: entry.source })
    }
  }

  return new Map([...latest].map(([field, { source }]) => [field, source]))
}

/** True when a person typed the value this field currently holds. */
export function isHandEntered(sources: Map<string, FieldSource>, field: string): boolean {
  return sources.get(field) === 'hand'
}
