import type { OverlayCollection, OverlayDefinition } from './types'

export type { OverlayArea, OverlayCollection, OverlayDefinition } from './types'

/*
  Loads the district overlays that `pnpm sagis:overlays` writes to
  public/overlays/.

  Fetched, never bundled, and never all at once. Sixteen boundary sets is 656KB
  altogether and a reader looks at one, so each is fetched the first time it is
  chosen and kept for the life of the page.

  Like the parcel layer, an absent file is an ordinary state rather than a
  crash: a clone that has not run the harvest simply has no overlays to offer.
*/

const INDEX_URL = '/overlays/index.json'

/*
  A host that answers a missing path with index.html, which is what the SPA
  rewrite in vercel.json makes it do, returns 200 and HTML. An ok response is
  not on its own proof the file exists.
*/
async function readJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch {
    // Offline, or no server. Not an error worth stopping the app for.
    return null
  }
  if (!response.ok) return null
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null
  return (await response.json()) as T
}

let indexPromise: Promise<OverlayDefinition[]> | null = null

/** What the plat can offer. Empty when the harvest has not been run. */
export function loadOverlayIndex(fetchImpl: typeof fetch = fetch): Promise<OverlayDefinition[]> {
  indexPromise ??= readJson<OverlayDefinition[]>(INDEX_URL, fetchImpl).then((rows) =>
    // An overlay the county published as empty is not worth offering.
    Array.isArray(rows) ? rows.filter((row) => row.areas > 0) : []
  )
  return indexPromise
}

const collections = new Map<string, Promise<OverlayCollection | null>>()

/** One overlay's boundaries. Cached per id for the life of the page. */
export function loadOverlay(
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<OverlayCollection | null> {
  const cached = collections.get(id)
  if (cached) return cached

  const promise = readJson<OverlayCollection>(`/overlays/${id}.json`, fetchImpl).then(
    (collection) =>
      collection && Array.isArray(collection.features) ? collection : null
  )
  collections.set(id, promise)
  return promise
}

/** Test seam. Both caches live for the life of the page otherwise. */
export function resetOverlayCacheForTests(): void {
  indexPromise = null
  collections.clear()
}
