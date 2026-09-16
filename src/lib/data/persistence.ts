import type { DemoData } from './fixtures'
import type { AuditEntry, Entity, Org, ReferenceItem, Relation } from './types'

/*
  Keeping work between page loads, until Supabase does it properly.

  The whole store cannot simply be written to localStorage: it holds 10,527
  records, almost all of them harvested county parcels, which is several
  megabytes against a quota of about five. It also would not be the right thing
  to save. Those parcels are reference data, rebuilt from the county on every
  load; what a board member types is not.

  So what is stored is the difference between the store and the freshly built
  baseline: records they created or changed, records they removed, and the audit
  trail of those actions. Everything untouched is left to be rebuilt. In
  practice that is a few dozen kilobytes rather than several megabytes.

  That split is also exactly the one Supabase inherits. The overlay is the
  user's data and becomes rows; the baseline is the parcel layer and becomes a
  table loaded from `data/sagis/parcels.ndjson`. Nothing here is throwaway.
*/

const STORAGE_KEY = 'artypest.overlay.v1'

/*
  Bumped when the shape changes, which discards an overlay we cannot read.

  2: entities carry `reviewedAt` and `reviewedBy`, audit rows carry `source`.
  A version 1 overlay would restore records with no hand mark and audit rows
  with no provenance, which would read as "checked by nobody, written by
  nobody" rather than as missing.

  3: the generated demo dataset was retired. An older overlay can contain full
  copies of edited fixture records and would otherwise bring fake people and
  activity back after the clean baseline loads.
*/
const SCHEMA_VERSION = 3

export interface Overlay {
  version: number
  savedAt: string
  org: Org | null
  /** Created or modified. Anything identical to the baseline is left out. */
  entities: Entity[]
  /** Present in the baseline, gone from the store. */
  removedEntityIds: string[]
  relations: Relation[]
  removedRelationIds: string[]
  /** Only entries about records in this overlay, so the log stays proportionate. */
  auditEntries: AuditEntry[]
  referenceItems: ReferenceItem[]
}

/**
 * Everything in `current` that is not already in `baseline`, by value.
 *
 * Compared with JSON rather than field by field. The records are plain data by
 * construction, key order is stable because both sides are built by the same
 * code, and being exact matters more here than being clever: a false difference
 * costs a few bytes, a missed one loses somebody's work.
 */
function changedById<T extends { id: string }>(
  current: readonly T[],
  baseline: readonly T[]
): { changed: T[]; removedIds: string[] } {
  const baselineById = new Map(baseline.map((row) => [row.id, JSON.stringify(row)]))

  const changed: T[] = []
  const seen = new Set<string>()

  for (const row of current) {
    seen.add(row.id)
    const before = baselineById.get(row.id)
    if (before === undefined || before !== JSON.stringify(row)) changed.push(row)
  }

  const removedIds = baseline.map((row) => row.id).filter((id) => !seen.has(id))

  return { changed, removedIds }
}

export function buildOverlay(current: DemoData, baseline: DemoData, now: string): Overlay {
  const entities = changedById(current.entities, baseline.entities)
  const relations = changedById(current.relations, baseline.relations)
  const referenceItems = changedById(current.referenceItems, baseline.referenceItems)

  /*
    The audit log is append only, so anything the baseline does not have is
    something the reader did. Keeping only those keeps the overlay small and
    the history honest: seeded history is rebuilt with the seed.
  */
  const baselineAudit = new Set(baseline.auditEntries.map((entry) => entry.id))
  const auditEntries = current.auditEntries.filter((entry) => !baselineAudit.has(entry.id))

  return {
    version: SCHEMA_VERSION,
    savedAt: now,
    org: JSON.stringify(current.org) === JSON.stringify(baseline.org) ? null : current.org,
    entities: entities.changed,
    removedEntityIds: entities.removedIds,
    relations: relations.changed,
    removedRelationIds: relations.removedIds,
    auditEntries,
    referenceItems: referenceItems.changed,
  }
}

function mergeById<T extends { id: string }>(
  baseline: readonly T[],
  changed: readonly T[],
  removedIds: readonly string[]
): T[] {
  const removed = new Set(removedIds)
  const byId = new Map<string, T>()

  for (const row of baseline) {
    if (!removed.has(row.id)) byId.set(row.id, row)
  }
  // Applied after, so a change to a baseline record wins over the baseline.
  for (const row of changed) byId.set(row.id, row)

  return [...byId.values()]
}

export function applyOverlay(baseline: DemoData, overlay: Overlay): DemoData {
  return {
    ...baseline,
    org: overlay.org ?? baseline.org,
    entities: mergeById(baseline.entities, overlay.entities, overlay.removedEntityIds),
    relations: mergeById(baseline.relations, overlay.relations, overlay.removedRelationIds),
    referenceItems: mergeById(baseline.referenceItems, overlay.referenceItems, []),
    auditEntries: [...baseline.auditEntries, ...overlay.auditEntries],
  }
}

/** True when the overlay holds nothing, so there is no reason to write it. */
export function isEmptyOverlay(overlay: Overlay): boolean {
  return (
    overlay.org === null &&
    overlay.entities.length === 0 &&
    overlay.removedEntityIds.length === 0 &&
    overlay.relations.length === 0 &&
    overlay.removedRelationIds.length === 0 &&
    overlay.auditEntries.length === 0 &&
    overlay.referenceItems.length === 0
  )
}

/* ------------------------------------------------------------- storage -- */

export interface OverlayStore {
  read(): Overlay | null
  write(overlay: Overlay): { ok: true } | { ok: false; reason: string }
  clear(): void
}

function isOverlay(value: unknown): value is Overlay {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Overlay>
  return (
    candidate.version === SCHEMA_VERSION &&
    Array.isArray(candidate.entities) &&
    Array.isArray(candidate.relations) &&
    Array.isArray(candidate.removedEntityIds)
  )
}

/**
 * localStorage, with every failure treated as "no saved work" rather than as a
 * crash.
 *
 * It is disabled outright in some private-browsing modes, and writing can throw
 * on quota even when reading is fine. Neither is a reason to take the
 * application down.
 */
export function createLocalOverlayStore(
  storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage
): OverlayStore {
  return {
    read() {
      if (!storage) return null
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (raw === null) return null
        const parsed: unknown = JSON.parse(raw)
        // A version we do not understand is discarded, not guessed at.
        return isOverlay(parsed) ? parsed : null
      } catch {
        return null
      }
    },

    write(overlay) {
      if (!storage) return { ok: false, reason: 'This browser is not storing anything locally.' }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(overlay))
        return { ok: true }
      } catch (error) {
        /*
          Almost always the quota, and almost always a photo. Saying which is
          the difference between a fixable problem and a mystery.
        */
        const quota = error instanceof DOMException && error.name === 'QuotaExceededError'
        return {
          ok: false,
          reason: quota
            ? 'There is no room left in this browser to save. Removing a photo or two will free some.'
            : 'This browser refused to save the change.',
        }
      }
    },

    clear() {
      if (!storage) return
      try {
        storage.removeItem(STORAGE_KEY)
      } catch {
        // Nothing useful to do, and nothing worth breaking the page over.
      }
    },
  }
}
