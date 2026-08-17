import type { ParcelRecord } from './types'

/*
  Loads the harvested parcel layer that `pnpm sagis:harvest` writes to
  public/parcels/.

  Those files are not committed. They are roughly 14MB on disk, they are rebuilt
  from the county service rather than edited, and they are headed for Postgres.
  So a fresh clone has no parcel layer at all, and that has to be an ordinary
  state rather than a crash: the app falls back to the committed 60-parcel
  fixture and says which it is using.

  The layer is never bundled. `src/lib/parcels/fixtures/chatham-sample.json` is
  imported and therefore compiled into the JavaScript; these are fetched, so
  4.8MB of parcels does not become 4.8MB of bundle.
*/

/** One parcel plus the neighborhood its centroid falls in. */
export interface ParcelLayerRecord extends ParcelRecord {
  /** Null when the parcel sits outside every neighborhood boundary. */
  neighborhood: string | null
}

export interface ParcelLayer {
  records: ParcelLayerRecord[]
  /** `harvest` when the served slice answered, `fixture` when it was absent. */
  source: 'harvest' | 'fixture'
}

const ATTRIBUTES_URL = '/parcels/attributes.json'
const GEOMETRY_URL = '/parcels/geometry.json'

/**
 * Fetches the parcel attributes.
 *
 * Returns an empty array rather than throwing when the slice is not there, so
 * the caller can fall back. A network or parse failure is different from an
 * absent file and is allowed to surface.
 */
export async function loadParcelLayer(fetchImpl: typeof fetch = fetch): Promise<ParcelLayer> {
  let response: Response
  try {
    response = await fetchImpl(ATTRIBUTES_URL)
  } catch {
    // Offline, or no server. Not an error worth stopping the app for.
    return { records: [], source: 'fixture' }
  }

  if (!response.ok) return { records: [], source: 'fixture' }

  /*
    Vite's dev server answers an unknown path with index.html rather than a 404,
    so an ok response is not on its own proof that the slice exists.
  */
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) return { records: [], source: 'fixture' }

  const records = (await response.json()) as ParcelLayerRecord[]
  if (!Array.isArray(records) || records.length === 0) {
    return { records: [], source: 'fixture' }
  }

  return { records, source: 'harvest' }
}

/** Longitude first, as GeoJSON requires. */
type Ring = [number, number][]

export interface ParcelGeometryCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: { pin: string }
    geometry: { type: 'Polygon'; coordinates: Ring[] } | null
  }[]
}

/*
  Geometry is fetched separately and only when something needs to draw. It is
  the larger half of the layer and most sessions never open the map.
*/
let geometryPromise: Promise<ParcelGeometryCollection | null> | null = null

export function loadParcelGeometry(
  fetchImpl: typeof fetch = fetch
): Promise<ParcelGeometryCollection | null> {
  geometryPromise ??= fetchImpl(GEOMETRY_URL)
    .then(async (response) => {
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('json')) return null
      return (await response.json()) as ParcelGeometryCollection
    })
    .catch(() => null)

  return geometryPromise
}

/** Test seam. The geometry fetch is cached for the life of the page. */
export function resetParcelGeometryCache(): void {
  geometryPromise = null
}
