import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'

import { buildDemoData, type DemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'
import {
  applyOverlay,
  buildOverlay,
  createLocalOverlayStore,
  isEmptyOverlay,
  type OverlayStore,
} from './persistence'
import { planLocalWork } from './copy-local-work'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { RemoteStore } from './remote'
import { createSupabaseRemote } from './supabase-remote'
import { withStableIds } from './stable-ids'
import { createSyncedProvider, type SyncedProvider } from './synced-provider'
import type { DataProvider } from './types'

/*
  The single place the app picks a data backend.

  Signed in to a configured database: the association's shared records, through
  SyncedProvider, connected by connectSharedRecords once the account is known.
  Otherwise, which is the demo, the test suite, and every fresh clone: in-memory
  fixtures with what the reader has typed layered on top and kept in the
  browser.

  Why `data` is a `let`. The harvested parcel layer is fetched, so it cannot be
  there at module-evaluation time, and it is 16,656 lots that have to become
  entities before anything reads them. `data` is an ES module live binding:
  every importer sees the reassignment, so `initializeData` can replace the
  provider once the layer has arrived without a single call site changing. Call
  sites reach through `data.method()` rather than destructuring, which is what
  makes that safe.
*/

/** Written after a change settles, so a burst of edits costs one save. */
const SAVE_DEBOUNCE_MS = 400

let store: OverlayStore = createLocalOverlayStore()
const includeTemporaryData = import.meta.env.MODE === 'test'
let baseline: DemoData = buildDemoData(new Date(), [], { includeTemporaryData })
let saveTimer: ReturnType<typeof setTimeout> | null = null

type PersistenceListener = (error: string | null) => void
const persistenceListeners = new Set<PersistenceListener>()

/** The last reason a save failed, almost always the storage quota. */
let lastPersistError: string | null = null

function announce(error: string | null) {
  lastPersistError = error
  for (const listener of persistenceListeners) listener(error)
}

/**
 * Subscribe to save failures.
 *
 * Failing to save is worth telling somebody about. Losing an afternoon of work
 * to a silently full quota is not something to find out about later.
 */
export function onPersistenceError(listener: PersistenceListener): () => void {
  persistenceListeners.add(listener)
  listener(lastPersistError)
  return () => persistenceListeners.delete(listener)
}

function saveNow() {
  // The shared records save themselves; this browser's copy is left as it was.
  if (shared) return
  const overlay = buildOverlay(provider.snapshot(), baseline, new Date().toISOString())

  // Back to the seeded state means there is nothing to remember.
  if (isEmptyOverlay(overlay)) {
    store.clear()
    announce(null)
    return
  }

  const result = store.write(overlay)
  announce(result.ok ? null : result.reason)
}

function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, SAVE_DEBOUNCE_MS)
}

/*
  Reads are named by convention in this codebase, and everything else changes
  something. Written as a list of read prefixes rather than a list of writes on
  purpose: a method added later that is not recognised gets saved, which costs
  one wasted diff. The other way round it would silently not be saved, which
  costs somebody their work.
*/
const READ_PREFIXES = ['list', 'get', 'count', 'resolve', 'snapshot']

function isRead(method: string): boolean {
  return READ_PREFIXES.some((prefix) => method.startsWith(prefix))
}

function withPersistence(target: DataProvider): DataProvider {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value: unknown = Reflect.get(object, property, receiver)
      if (typeof value !== 'function' || typeof property !== 'string' || isRead(property)) {
        return value
      }

      const method = value as (...args: unknown[]) => unknown
      return (...args: unknown[]): unknown => {
        const result = method.apply(object, args)
        if (result instanceof Promise) {
          return result.then((resolved: unknown) => {
            scheduleSave()
            return resolved
          })
        }
        scheduleSave()
        return result
      }
    },
  })
}

function build(data: DemoData): DataProvider {
  baseline = data

  const saved = store.read()
  // A saved overlay is layered onto the freshly built baseline, so the county
  // parcels stay current while the reader's own work survives.
  const start = saved === null ? data : applyOverlay(data, saved)

  return withPersistence(createMemoryProvider(start))
}

let provider: DataProvider = build(baseline)

export let data: DataProvider = provider

/** `harvest` once the served slice has been loaded, `fixture` before that. */
export let parcelLayerSource: 'harvest' | 'fixture' = 'fixture'

/** Set while signed in to the shared records. */
let shared: SyncedProvider | null = null

/**
 * Rebuilds the provider with the harvested parcel layer folded in, and with any
 * saved work layered back on top.
 *
 * Call once before rendering. The client dataset is clean even when the county
 * layer is unavailable: supplied contacts remain, but generated demo records
 * are never shown in the running website.
 */
export function initializeData(
  parcels: readonly ParcelLayerRecord[],
  source: 'harvest' | 'fixture' = 'harvest'
): void {
  provider = build(buildDemoData(new Date(), parcels, { includeTemporaryData: false }))
  data = provider
  parcelLayerSource = parcels.length === 0 ? 'fixture' : source
}

/**
 * Throws away everything saved in this browser and returns to the seeded demo.
 *
 * Deliberately requires a reload rather than rebuilding in place: React Query
 * holds cached results keyed to records that are about to stop existing, and
 * reasoning about that is not worth it for a control used once.
 */
export function resetLocalWork(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  store.clear()
  announce(null)
}

/** True when there is saved work in this browser. */
export function hasLocalWork(): boolean {
  return store.read() !== null
}

/* -------------------------------------------------------- shared records -- */

/**
 * Switches the whole app to the association's shared records.
 *
 * Called once the signed-in account is known, because row level security
 * returns nothing to nobody. Reads everything the database holds for the
 * association and lays it over the county layer and the supplied contacts.
 */
export async function connectSharedRecords(remote: RemoteStore): Promise<void> {
  const snapshot = await remote.loadAll()
  // The same starting data this browser built, on the ids every browser shares.
  const starting = withStableIds(baseline).data
  shared = createSyncedProvider({ remote, baseline: starting, snapshot })
  data = shared
}

type RemoteFactory = (client: SupabaseClient<Database>, orgId: string) => RemoteStore
let remoteFactory: RemoteFactory = createSupabaseRemote

/** Where the shared records live for this account. Supabase, except in tests. */
export function remoteFor(client: SupabaseClient<Database>, orgId: string): RemoteStore {
  return remoteFactory(client, orgId)
}

/** Test seam. Signed-in tests keep their records in memory, not on a network. */
export function setRemoteForTests(factory: RemoteFactory | null): void {
  remoteFactory = factory ?? createSupabaseRemote
}

/** Back to this browser's own store, on signing out. */
export function disconnectSharedRecords(): void {
  shared = null
  data = provider
}

export function isSharedRecords(): boolean {
  return shared !== null
}

/** Picks up what anyone else has written. True when something changed. */
export function refreshSharedRecords(): Promise<boolean> {
  return shared ? shared.refresh() : Promise.resolve(false)
}

/**
 * Copies the work saved in this browser into the shared records, as one batch
 * so Activity shows it together, then forgets the browser's copy.
 *
 * Kept until every write has succeeded: a copy that fails halfway can be run
 * again, and what already went in is not written twice.
 */
export async function copyLocalWorkToShared(): Promise<{ records: number; connections: number }> {
  const target = shared
  if (!target) throw new Error('Sign in to the shared records first.')
  const overlay = store.read()
  if (!overlay) return { records: 0, connections: 0 }

  const work = planLocalWork(overlay, baseline, await target.listRelationTypes())
  await target.runBatch(async () => {
    for (const entity of work.entities) await target.adoptEntity(entity)
    for (const relation of work.relations) await target.adoptRelation(relation)
  })

  resetLocalWork()
  return { records: work.entities.length, connections: work.relations.length }
}

/** Test seam. Swaps the storage and rebuilds from the current baseline. */
export function useOverlayStoreForTests(next: OverlayStore): void {
  store = next
  provider = build(baseline)
  data = provider
}

export * from './types'
