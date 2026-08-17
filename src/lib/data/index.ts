import type { ParcelLayerRecord } from '@/lib/parcels/parcel-layer'

import { buildDemoData } from './fixtures'
import { createMemoryProvider } from './memory-provider'
import type { DataProvider } from './types'

/*
  The single place the app picks a data backend.

  Today: in-memory fixtures, because the Supabase stack is not set up yet.
  Later: swap this for the Supabase provider. Nothing that imports `data` needs
  to change, because both sides satisfy DataProvider.

  Why this is a `let` rather than a `const`. The harvested parcel layer is
  fetched, so it cannot be there at module-evaluation time, and it is 10,399
  lots that have to become entities before anything reads them. `data` is an ES
  module live binding: every importer sees the reassignment, so `initializeData`
  can replace the provider once the layer has arrived without a single call site
  changing. Call sites reach through `data.method()` rather than destructuring,
  which is what makes that safe.

  The default is deliberately the small demo. Tests and any path that has not
  fetched anything get the 48 lots the association tracks, so the suite stays
  fast and offline, and the app still works when the slice is absent.
*/
export let data: DataProvider = createMemoryProvider(buildDemoData())

/** `harvest` once the served slice has been loaded, `fixture` before that. */
export let parcelLayerSource: 'harvest' | 'fixture' = 'fixture'

/**
 * Rebuilds the provider with the harvested parcel layer folded in.
 *
 * Call once, before rendering. Calling it with an empty array is a no-op that
 * leaves the fixture demo in place, which is the fallback when
 * public/parcels/attributes.json has not been generated.
 */
export function initializeData(
  parcels: readonly ParcelLayerRecord[],
  source: 'harvest' | 'fixture' = 'harvest'
): void {
  if (parcels.length === 0) {
    parcelLayerSource = 'fixture'
    return
  }

  data = createMemoryProvider(buildDemoData(new Date(), parcels))
  parcelLayerSource = source
}

export * from './types'
